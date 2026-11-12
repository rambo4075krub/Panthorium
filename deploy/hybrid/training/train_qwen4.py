"""Actual supervised BF16 LoRA trainer, separate from the production notebook.
Validates approved bundle, hardware and split isolation before downloading weights.
Produces a candidate adapter plus baseline/held-out evaluation; never auto-promotes.
"""
import argparse, datetime, hashlib, importlib.metadata, json, math, os, shutil, subprocess, sys
from pathlib import Path

BASE_MODEL = 'Qwen/Qwen3.5-4B'
BASE_REVISION = '851bf6e806efd8d0a36b00ddf55e13ccb7b8cd0a'
GIB = 1024**3

def sha(data): return hashlib.sha256(data).hexdigest()

def read_bundle(directory):
    manifest = json.loads((directory/'manifest.json').read_text(encoding='utf-8'))
    if (manifest.get('schema') != 1 or manifest.get('model') != BASE_MODEL or
        manifest.get('revision') != BASE_REVISION or manifest.get('method') != 'bf16-lora' or
        manifest.get('scope') != 'approved-global-training' or manifest.get('mode') != 'text' or
        manifest.get('automaticProductionPromotion') is not False):
        raise ValueError('Unrecognized training manifest')
    data = {}
    seen = set()
    for split in ('train','validation'):
        spec = manifest[split]
        if spec['file'] != split+'.jsonl': raise ValueError('Invalid dataset path')
        path = directory/spec['file']
        if path.is_symlink() or path.stat().st_size > 20*1024**2: raise ValueError('Invalid dataset file')
        raw = path.read_bytes()
        if sha(raw) != spec['sha256']: raise ValueError('Dataset checksum mismatch')
        rows = [json.loads(line) for line in raw.decode('utf-8').splitlines() if line.strip()]
        if len(rows) != spec['count'] or len(rows) < (18 if split=='train' else 2): raise ValueError('Insufficient dataset')
        for row in rows:
            messages = row.get('messages')
            if (not isinstance(messages,list) or len(messages)!=2 or
                [m.get('role') for m in messages]!=['user','assistant'] or
                any(not isinstance(m.get('content'),str) or not m['content'].strip() or len(m['content'])>12000 for m in messages)):
                raise ValueError('Invalid training messages')
            import unicodedata
            key = sha(unicodedata.normalize('NFKC',messages[0]['content'].strip()).lower().encode())
            if key in seen: raise ValueError('Duplicate prompt or evaluation leakage')
            seen.add(key)
        data[split] = rows
    return manifest, data

def hardware_check(directory):
    # Run before importing Torch/Unsloth or downloading a multi-GB base model.
    if os.name == 'nt': return {'ready':False,'reason':'Use a dedicated Linux CUDA runner or WSL2; do not train on the production host'}
    try:
        result = subprocess.run(['nvidia-smi','--query-gpu=memory.free,memory.total','--format=csv,noheader,nounits'],capture_output=True,text=True,check=True,timeout=10)
        gpus = [tuple(float(v.strip()) for v in line.split(',')) for line in result.stdout.strip().splitlines()]
        if len(gpus)!=1: return {'ready':False,'reason':'Select a dedicated runner with exactly one visible GPU'}
        free,total = gpus[0]
    except (OSError,ValueError,subprocess.SubprocessError):return {'ready':False,'reason':'CUDA GPU metrics unavailable'}
    ready = free >= 10*1024 and shutil.disk_usage(directory).free >= 35*GIB
    return {'ready':ready,'freeVramGiB':round(free/1024,2),'totalVramGiB':round(total/1024,2),
            'reason':None if ready else 'Need >=10 GiB free VRAM and >=35 GiB disk; 16 GiB GPU recommended'}

def write_status(output, status):
    target=output/'status.json';temporary=output/'status.json.tmp'
    temporary.write_text(json.dumps(status,indent=2),encoding='utf-8');temporary.replace(target)

def train(directory, output, steps, export_gguf=False):
    manifest, data = read_bundle(directory)
    hardware = hardware_check(directory)
    if not hardware['ready']: raise RuntimeError(hardware['reason'])
    # No hosted logging or automatic Hub upload of user data/weights.
    os.environ['WANDB_DISABLED']='true';os.environ['HF_HUB_DISABLE_TELEMETRY']='1'
    os.environ['TOKENIZERS_PARALLELISM']='false'
    from unsloth import FastVisionModel
    from unsloth.trainer import UnslothVisionDataCollator
    import torch
    from trl import SFTTrainer, SFTConfig
    from datasets import Dataset
    if not torch.cuda.is_available() or not torch.cuda.is_bf16_supported(): raise RuntimeError('BF16 CUDA support required')
    # A new directory prevents overwriting a completed adapter or concurrent job.
    output.mkdir(parents=True,exist_ok=False)
    record={'state':'running','model':BASE_MODEL,'revision':BASE_REVISION,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'manifestSha256':sha((directory/'manifest.json').read_bytes()),'hardware':hardware,
            'automaticProductionPromotion':False,'versions':{name:importlib.metadata.version(name) for name in ['torch','transformers','unsloth','trl','peft']}}
    write_status(output,record)
    try:
        model,processor=FastVisionModel.from_pretrained(BASE_MODEL,revision=BASE_REVISION,load_in_4bit=False,
            use_gradient_checkpointing='unsloth',dtype=torch.bfloat16,trust_remote_code=False)
        tokenizer=getattr(processor,'tokenizer',processor)
        for rows in data.values():
            for row in rows:
                text=processor.apply_chat_template(row['messages'],tokenize=False,add_generation_prompt=False)
                if len(tokenizer(text,add_special_tokens=False)['input_ids'])>2048:
                    raise RuntimeError('Training example exceeds 2048 tokens; shorten it before training')
        model=FastVisionModel.get_peft_model(model,finetune_vision_layers=False,finetune_language_layers=True,
            finetune_attention_modules=True,finetune_mlp_modules=True,r=16,lora_alpha=16,lora_dropout=0,bias='none',random_state=3407)
        FastVisionModel.for_training(model)
        # The official vision collator also handles text conversations; preserving
        # typed text content keeps the processor's own chat template authoritative.
        def converted(rows):
            return Dataset.from_list([{'messages':[{'role':m['role'],'content':[{'type':'text','text':m['content']}]} for m in row['messages']]} for row in rows])
        args=SFTConfig(output_dir=str(output/'checkpoints'),per_device_train_batch_size=1,per_device_eval_batch_size=1,
            gradient_accumulation_steps=4,warmup_steps=min(5,steps//5),max_steps=steps,learning_rate=2e-5,
            logging_steps=1,optim='adamw_8bit',weight_decay=.01,seed=3407,bf16=True,fp16=False,report_to='none',
            remove_unused_columns=False,dataset_text_field='',dataset_kwargs={'skip_prepare_dataset':True},max_length=2048,
            save_strategy='no',prediction_loss_only=True)
        trainer=SFTTrainer(model=model,tokenizer=processor,data_collator=UnslothVisionDataCollator(model,processor),
            train_dataset=converted(data['train']),eval_dataset=converted(data['validation']),args=args)
        # Measure the same held-out prompts before and after adapter training.
        baseline=float(trainer.evaluate()['eval_loss'])
        trainer.train()
        candidate=float(trainer.evaluate()['eval_loss'])
        if not math.isfinite(baseline) or not math.isfinite(candidate): raise RuntimeError('Non-finite evaluation loss')
        model.save_pretrained(str(output/'adapter'));processor.save_pretrained(str(output/'adapter'))
        record.update(state='candidate',baselineLoss=baseline,candidateLoss=candidate,
            lossGatePassed=candidate<=baseline,requiresReview=['Thai answers','reasoning','tool calling','vision','latency','RAM/VRAM'],
            finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
        write_status(output,record)
        if export_gguf:
            if candidate>baseline: raise RuntimeError('Held-out loss regressed; GGUF export blocked')
            model.save_pretrained_gguf(str(output/'gguf'),processor,quantization_method='q4_k_m')
            record['ggufExported']=True
            record['ggufFiles']=[{'file':str(p.relative_to(output)),'sha256':file_sha(p),'bytes':p.stat().st_size} for p in (output/'gguf').rglob('*.gguf')]
            write_status(output,record)
        return record
    except BaseException as exc:
        record.update(state='failed',errorType=type(exc).__name__)
        write_status(output,record)
        raise

def file_sha(path):
    digest=hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda:stream.read(8*1024**2),b''):digest.update(chunk)
    return digest.hexdigest()

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--bundle',type=Path,default=Path('.'))
    parser.add_argument('--output',type=Path,default=Path('qwen4-candidate'))
    parser.add_argument('--steps',type=int,default=50)
    parser.add_argument('--preflight',action='store_true')
    parser.add_argument('--export-gguf',action='store_true')
    args=parser.parse_args()
    if not 1<=args.steps<=500:parser.error('--steps must be 1..500')
    read_bundle(args.bundle)
    if args.preflight:
        result=hardware_check(args.bundle);print(json.dumps(result));sys.exit(0 if result['ready'] else 2)
    print(json.dumps(train(args.bundle,args.output,args.steps,args.export_gguf)))
