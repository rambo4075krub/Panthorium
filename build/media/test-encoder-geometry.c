/* Regression checks against the actual newly built libavcodec. */
#include <stdio.h>
#include <errno.h>
#include <string.h>
#include "libavcodec/avcodec.h"
#include "libavutil/opt.h"

static int apng_geometry(int width, int height, int expected)
{
    const AVCodec *codec = avcodec_find_encoder(AV_CODEC_ID_APNG);
    AVCodecContext *ctx = avcodec_alloc_context3(codec);
    AVFrame *frame = av_frame_alloc();
    int result = 1;
    if (!codec || !ctx || !frame) goto end;
    ctx->width = 16; ctx->height = 16;
    ctx->pix_fmt = AV_PIX_FMT_RGBA; ctx->time_base = (AVRational){1, 25};
    if (avcodec_open2(ctx, codec, NULL) < 0) goto end;
    frame->width = width; frame->height = height; frame->format = ctx->pix_fmt;
    if (av_frame_get_buffer(frame, 32) < 0) goto end;
    memset(frame->data[0], 0, (size_t)frame->linesize[0] * height);
    result = avcodec_send_frame(ctx, frame) != expected;
end:
    av_frame_free(&frame); avcodec_free_context(&ctx);
    return result;
}

int main(void)
{
    const AVCodec *codec = avcodec_find_encoder(AV_CODEC_ID_HUFFYUV);
    AVCodecContext *ctx = avcodec_alloc_context3(codec);
    int ret;
    if (apng_geometry(16, 16, 0) ||
        apng_geometry(32, 16, AVERROR(EINVAL)) ||
        apng_geometry(16, 32, AVERROR(EINVAL)) ||
        apng_geometry(8, 16, AVERROR(EINVAL))) return 1;
    if (!codec || !ctx) return 2;
    ctx->width = 2; ctx->height = 2;
    ctx->pix_fmt = AV_PIX_FMT_YUV422P; ctx->time_base = (AVRational){1, 25};
    if (av_opt_set(ctx->priv_data, "pred", "median", 0) < 0) return 3;
    ret = avcodec_open2(ctx, codec, NULL);
    avcodec_free_context(&ctx);
    if (ret != AVERROR(EINVAL)) return 4;
    puts("PASS: valid APNG frame accepted; oversized/undersized frames and unsafe Huffyuv median geometry rejected");
    return 0;
}
