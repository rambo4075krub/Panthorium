/* Public API regressions for the repaired AES-GCM-SIV authentication paths. */
#include <stdio.h>
#include <string.h>
#include <openssl/evp.h>
#include <openssl/core_names.h>
#include <openssl/params.h>
#include <openssl/err.h>

static int encrypt(int empty_update, int reuse, unsigned char output[48])
{
    unsigned char key[16] = {0}, iv[12] = {0}, text[32] = {0};
    unsigned char aad[8] = {1,2,3,4,5,6,7,8};
    EVP_CIPHER *cipher = EVP_CIPHER_fetch(NULL, "AES-128-GCM-SIV", NULL);
    EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new();
    int n, written, ok = 0;
    if (!cipher || !ctx || !EVP_EncryptInit_ex2(ctx, cipher, key, iv, NULL)) goto end;
    if (reuse && (!EVP_EncryptUpdate(ctx, NULL, &n, aad, sizeof(aad)) ||
                  !EVP_EncryptInit_ex2(ctx, NULL, key, iv, NULL))) goto end;
    if (!EVP_EncryptUpdate(ctx, NULL, &n, aad, 4)) goto end;
    if (empty_update && !EVP_EncryptUpdate(ctx, NULL, &n, aad, 0)) goto end;
    if (!EVP_EncryptUpdate(ctx, NULL, &n, aad + 4, 4)) goto end;
    if (!EVP_EncryptUpdate(ctx, output, &written, text, sizeof(text))) goto end;
    if (!EVP_EncryptFinal_ex(ctx, output + written, &n) || written + n != 32) goto end;
    if (!EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_AEAD_GET_TAG, 16, output + 32)) goto end;
    ok = 1;
end:
    EVP_CIPHER_CTX_free(ctx); EVP_CIPHER_free(cipher);
    return ok;
}

static int iv_length(size_t length)
{
    EVP_CIPHER *cipher = EVP_CIPHER_fetch(NULL, "AES-128-GCM-SIV", NULL);
    EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new();
    OSSL_PARAM params[] = { OSSL_PARAM_END, OSSL_PARAM_END };
    int result = -1;
    params[0] = OSSL_PARAM_construct_size_t(OSSL_CIPHER_PARAM_AEAD_IVLEN, &length);
    if (cipher && ctx && EVP_EncryptInit_ex2(ctx, cipher, NULL, NULL, NULL))
        result = EVP_CIPHER_CTX_set_params(ctx, params);
    EVP_CIPHER_CTX_free(ctx); EVP_CIPHER_free(cipher); ERR_clear_error();
    return result;
}

int main(void)
{
    unsigned char baseline[48], empty[48], reused[48];
    if (!encrypt(0, 0, baseline) || !encrypt(1, 0, empty) || !encrypt(0, 1, reused)) return 1;
    if (memcmp(baseline, empty, sizeof(baseline))) return 2;
    if (memcmp(baseline, reused, sizeof(baseline))) return 3;
    if (iv_length(12) != 1 || iv_length(11) != 0 || iv_length(13) != 0) return 4;
    puts("PASS: empty AAD retains authentication, context reuse clears stale AAD, invalid nonce lengths rejected");
    return 0;
}
