"""Bounded inline vision input. No URLs, filesystem paths or decoder-side fetches."""
import base64, binascii, io, re, warnings

MAX_IMAGES = 4
MAX_IMAGE_BYTES = 256 * 1024
MAX_BODY_BYTES = 1500 * 1024

def normalize_messages(messages):
    from PIL import Image, ImageOps, UnidentifiedImageError
    if not isinstance(messages, list) or not 1 <= len(messages) <= 80:
        raise ValueError('invalid_messages')
    count = 0
    text_size = 0
    output = []
    for message in messages:
        if not isinstance(message, dict) or message.get('role') not in ('system', 'user', 'assistant', 'tool'):
            raise ValueError('invalid_messages')
        content = message.get('content')
        if isinstance(content, list):
            if message['role'] != 'user' or len(content) > 12:
                raise ValueError('invalid_media')
            parts = []
            for part in content:
                if not isinstance(part, dict): raise ValueError('invalid_media')
                if part.get('type') == 'text' and isinstance(part.get('text'), str):
                    text_size += len(part['text'])
                    parts.append({'type':'text', 'text':part['text']})
                    continue
                if part.get('type') != 'image_url' or not isinstance(part.get('image_url'), dict):
                    raise ValueError('invalid_media')
                count += 1
                url = part['image_url'].get('url', '')
                if not isinstance(url, str) or len(url) > 350000 or count > MAX_IMAGES:
                    raise ValueError('invalid_media')
                match = re.fullmatch(r'data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})', url)
                if not match: raise ValueError('inline_images_required')
                try:
                    raw = base64.b64decode(match[2], validate=True)
                    if not 12 <= len(raw) <= MAX_IMAGE_BYTES: raise ValueError('invalid_media')
                    with warnings.catch_warnings():
                        warnings.simplefilter('error', Image.DecompressionBombWarning)
                        with Image.open(io.BytesIO(raw)) as source:
                            if source.format not in ('JPEG','PNG','WEBP') or source.width * source.height > 1024**2 or getattr(source,'n_frames',1) != 1:
                                raise ValueError('image_dimensions_exceeded')
                            source.load()
                            image = ImageOps.exif_transpose(source).convert('RGB')
                            image.thumbnail((768, 768))
                            encoded = io.BytesIO()
                            image.save(encoded, format='JPEG', quality=80)
                    # Strip metadata and normalize decoder input before llama.cpp.
                    parts.append({'type':'image_url','image_url':{'url':'data:image/jpeg;base64,' + base64.b64encode(encoded.getvalue()).decode()}})
                except (OSError, binascii.Error, UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning) as exc:
                    raise ValueError('invalid_image') from exc
            output.append({**message, 'content':parts})
        elif isinstance(content, str) or (content is None and message.get('tool_calls')):
            text_size += len(content or '')
            output.append(message)
        else:
            raise ValueError('invalid_messages')
    if text_size > 20000: raise ValueError('text_too_large')
    return output, count
