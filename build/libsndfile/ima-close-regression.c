/* Exercise the exact internal close function with a virtual completed writer.
 * Section GC removes unrelated decoder functions, so no large audio is encoded. */
#include <assert.h>
#include <stdio.h>
#include "ima_adpcm.c"
int main(void) {
    SF_PRIVATE psf = {0}; IMA_ADPCM_PRIVATE pima = {0};
    psf.file.mode=SFM_WRITE; psf.sf.channels=1; psf.codec_data=&pima;
    pima.samplesperblock=50000; pima.blockcount=50000;
    assert(ima_close(&psf)==0); assert(psf.sf.frames==2500000000LL);
    puts("IMA close frame count exceeds INT_MAX without overflow"); return 0;
}
