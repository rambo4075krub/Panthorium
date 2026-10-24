/* Synthetic virtual streams: no large allocation, external file, or network. */
#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "sndfile.h"

typedef struct { unsigned char header[256]; sf_count_t used, length, offset; } Stream;
static sf_count_t length(void *user) { return ((Stream *) user)->length; }
static sf_count_t seek(sf_count_t offset, int whence, void *user) {
    Stream *s = user;
    sf_count_t next = (whence == SEEK_SET ? 0 : whence == SEEK_CUR ? s->offset : s->length) + offset;
    if (next < 0 || next > s->length) return -1;
    return s->offset = next;
}
static sf_count_t read_bytes(void *data, sf_count_t count, void *user) {
    Stream *s = user;
    if (count > s->length - s->offset) count = s->length - s->offset;
    memset(data, 0, (size_t) count);
    if (s->offset < s->used) {
        sf_count_t n = s->used - s->offset;
        if (n > count) n = count;
        memcpy(data, s->header + s->offset, (size_t) n);
    }
    s->offset += count;
    return count;
}
static sf_count_t write_bytes(const void *data, sf_count_t count, void *user) { (void)data; (void)count; (void)user; return 0; }
static sf_count_t tell(void *user) { return ((Stream *) user)->offset; }
static SF_VIRTUAL_IO io = { length, seek, read_bytes, write_bytes, tell };
static void u32(Stream *s, uint32_t v) { for (int i=0; i<4; i++) s->header[s->used++] = (unsigned char)(v >> (i*8)); }
static void u16(Stream *s, unsigned v) { s->header[s->used++] = v & 255; s->header[s->used++] = v >> 8; }
static void text4(Stream *s, const char *v) { memcpy(s->header+s->used,v,4);s->used+=4; }
static void f64(Stream *s, double value) {
    uint64_t bits; memcpy(&bits,&value,8);
    for (int i=0;i<8;i++) s->header[s->used++]=(unsigned char)(bits>>(i*8));
}
static Stream mat4(int32_t rows, int32_t cols) {
    Stream s = {0};
    u32(&s,0); u32(&s,1); u32(&s,1); u32(&s,0); u32(&s,1); s.header[s.used++]=0; f64(&s,16000);
    u32(&s,0); u32(&s,(uint32_t)rows); u32(&s,(uint32_t)cols); u32(&s,0); u32(&s,1); s.header[s.used++]=0;
    f64(&s,0.25); f64(&s,-0.25); s.length=s.used; return s;
}
int main(int argc, char **argv) {
    assert(argc==2); SF_INFO info={0}; Stream s={0}; SNDFILE *f;
    if (!strcmp(argv[1],"mat4-invalid")) {
        s=mat4(INT32_MIN,INT32_MIN);
        f=sf_open_virtual(&io,SFM_READ,&info,&s);
        assert(f==NULL); puts("Rejected negative MAT4 dimensions without arithmetic overflow");
    } else if (!strcmp(argv[1],"mat4-valid")) {
        s=mat4(1,2); f=sf_open_virtual(&io,SFM_READ,&info,&s); assert(f!=NULL);
        double samples[2]={0}; assert(sf_readf_double(f,samples,2)==2);
        assert(samples[0]==0.25 && samples[1]==-0.25); assert(sf_close(f)==0);
        puts("Valid MAT4 samples preserved");
    } else if (!strcmp(argv[1],"ima-read")) {
        const uint32_t blocksize=25004, blocks=50000, samplesperblock=50001, data=blocksize*blocks;
        text4(&s,"RIFF"); u32(&s,data+40); text4(&s,"WAVE"); text4(&s,"fmt ");u32(&s,20);
        u16(&s,17);u16(&s,1);u32(&s,16000);u32(&s,8000);u16(&s,blocksize);u16(&s,4);u16(&s,2);u16(&s,samplesperblock);
        text4(&s,"data");u32(&s,data);s.length=s.used+(sf_count_t)data;
        f=sf_open_virtual(&io,SFM_READ,&info,&s); assert(f!=NULL);
        assert(info.frames==(sf_count_t)samplesperblock*blocks); assert(sf_close(f)==0);
        puts("IMA frame count exceeds INT_MAX without overflow or large allocation");
    } else return 2;
    return 0;
}
