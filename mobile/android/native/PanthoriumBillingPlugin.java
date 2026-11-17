package com.panthorium.browser;

import android.net.Uri;
import com.android.billingclient.api.*;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** Google Play one-time purchases; entitlement checks always run on the server. */
@CapacitorPlugin(name = "PanthoriumBilling")
public class PanthoriumBillingPlugin extends Plugin implements PurchasesUpdatedListener {
    private static final String CLOUD_ORIGIN = __PANTHORIUM_CLOUD_ORIGIN__;
    private BillingClient client;
    private PluginCall purchaseCall;

    private boolean trusted(PluginCall call) {
        Uri current = Uri.parse(getBridge().getWebView().getUrl() == null ? "" : getBridge().getWebView().getUrl());
        Uri allowed = Uri.parse(CLOUD_ORIGIN);
        if (!"https".equals(current.getScheme()) || !allowed.getHost().equals(current.getHost()) || current.getPort() != allowed.getPort()) {
            call.reject("untrusted_origin"); return false;
        }
        return true;
    }
    private void connected(PluginCall call, Runnable next) {
        if (!trusted(call)) return;
        getActivity().runOnUiThread(() -> {
            if (client == null) client = BillingClient.newBuilder(getContext()).setListener(this)
                .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
                .enableAutoServiceReconnection().build();
            if (client.isReady()) { next.run(); return; }
            client.startConnection(new BillingClientStateListener() {
                @Override public void onBillingSetupFinished(BillingResult result) {
                    if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) next.run();
                    else call.reject("google_play_unavailable");
                }
                @Override public void onBillingServiceDisconnected() { }
            });
        });
    }
    private boolean validSku(String id) { return id != null && id.matches("panthorium_[a-z0-9_]{1,80}"); }
    private void query(List<String> ids, ProductDetailsResponseListener listener) {
        List<QueryProductDetailsParams.Product> products = new ArrayList<>();
        for (String id : ids) products.add(QueryProductDetailsParams.Product.newBuilder().setProductId(id).setProductType(BillingClient.ProductType.INAPP).build());
        client.queryProductDetailsAsync(QueryProductDetailsParams.newBuilder().setProductList(products).build(), listener);
    }
    @PluginMethod public void getProducts(PluginCall call) {
        JSArray requested = call.getArray("productIds");
        if (requested == null || requested.length() == 0 || requested.length() > 20) { call.reject("invalid_product"); return; }
        List<String> ids = new ArrayList<>();
        for (int i = 0; i < requested.length(); i++) { String id = requested.optString(i); if (!validSku(id)) { call.reject("invalid_product"); return; } ids.add(id); }
        connected(call, () -> query(ids, (result, details) -> {
            if (result.getResponseCode() != BillingClient.BillingResponseCode.OK) { call.reject("google_play_unavailable"); return; }
            JSArray products = new JSArray();
            for (ProductDetails p : details.getProductDetailsList()) {
                List<ProductDetails.OneTimePurchaseOfferDetails> offers = p.getOneTimePurchaseOfferDetailsList();
                if (offers == null) continue;
                for (ProductDetails.OneTimePurchaseOfferDetails offer : offers) {
                    // Only ordinary, one-time purchase options; no rentals or subscriptions.
                    if (offer.getRentalDetails() != null) continue;
                    JSObject out = new JSObject(); out.put("storeProductId",p.getProductId());out.put("offerToken",offer.getOfferToken());out.put("formattedPrice",offer.getFormattedPrice());out.put("amountMicros",offer.getPriceAmountMicros());out.put("currency",offer.getPriceCurrencyCode());products.put(out);
                }
            }
            JSObject out = new JSObject();out.put("products",products);call.resolve(out);
        }));
    }
    @PluginMethod public void purchase(PluginCall call) {
        String productId=call.getString("storeProductId"),orderId=call.getString("orderId"),accountId=call.getString("accountId"),offerToken=call.getString("offerToken");
        Long amount=call.getLong("amountMicros");String currency=call.getString("currency");
        if (!validSku(productId) || orderId==null || !orderId.matches("[0-9a-f-]{36}") || accountId==null || !accountId.matches("[0-9a-f]{64}") || offerToken==null || amount==null || amount<=0 || !"THB".equals(currency)) { call.reject("invalid_purchase");return; }
        if (purchaseCall!=null) { call.reject("purchase_in_progress");return; }
        connected(call, () -> query(Collections.singletonList(productId),(result,details)->{
            if (result.getResponseCode()!=BillingClient.BillingResponseCode.OK || details.getProductDetailsList().size()!=1) {call.reject("google_play_unavailable");return;}
            ProductDetails product=details.getProductDetailsList().get(0);boolean matches=false;
            if(product.getOneTimePurchaseOfferDetailsList()!=null)for(ProductDetails.OneTimePurchaseOfferDetails offer:product.getOneTimePurchaseOfferDetailsList())if(offerToken.equals(offer.getOfferToken()) && offer.getRentalDetails()==null && offer.getPriceAmountMicros()==amount && currency.equals(offer.getPriceCurrencyCode()))matches=true;
            if(!matches){call.reject("price_changed");return;}
            BillingFlowParams.ProductDetailsParams item=BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(product).setOfferToken(offerToken).build();
            BillingFlowParams params=BillingFlowParams.newBuilder().setProductDetailsParamsList(Collections.singletonList(item)).setObfuscatedAccountId(accountId).setObfuscatedProfileId(orderId).build();
            getActivity().runOnUiThread(()->{
                if(!trusted(call))return;
                if(purchaseCall!=null){call.reject("purchase_in_progress");return;}
                purchaseCall=call;BillingResult launch=client.launchBillingFlow(getActivity(),params);
                if(launch.getResponseCode()!=BillingClient.BillingResponseCode.OK){purchaseCall=null;call.reject("google_play_unavailable");}
            });
        }));
    }
    private JSArray purchases(List<Purchase> purchases) {
        JSArray out=new JSArray();
        if(purchases==null)return out;
        for(Purchase purchase:purchases){JSObject item=new JSObject();item.put("purchaseToken",purchase.getPurchaseToken());item.put("state",purchase.getPurchaseState());item.put("orderId",purchase.getAccountIdentifiers()==null?null:purchase.getAccountIdentifiers().getObfuscatedProfileId());item.put("accountId",purchase.getAccountIdentifiers()==null?null:purchase.getAccountIdentifiers().getObfuscatedAccountId());out.put(item);}return out;
    }
    @Override public void onPurchasesUpdated(BillingResult result,List<Purchase> purchases) {
        PluginCall pending=purchaseCall;purchaseCall=null;
        JSObject out=new JSObject();out.put("purchases",purchases(purchases));
        if(result.getResponseCode()==BillingClient.BillingResponseCode.OK){notifyListeners("purchasesUpdated",out);if(pending!=null)pending.resolve(out);}
        else if(pending!=null){if(result.getResponseCode()==BillingClient.BillingResponseCode.USER_CANCELED){out.put("cancelled",true);pending.resolve(out);}else pending.reject("google_play_unavailable");}
    }
    @PluginMethod public void restorePurchases(PluginCall call) {
        connected(call,()->client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build(),(result,purchases)->{
            if(result.getResponseCode()!=BillingClient.BillingResponseCode.OK){call.reject("google_play_unavailable");return;}
            JSObject out=new JSObject();out.put("purchases",purchases(purchases));call.resolve(out);
        }));
    }
    @Override protected void handleOnDestroy(){if(client!=null)client.endConnection();if(purchaseCall!=null){purchaseCall.reject("purchase_interrupted");purchaseCall=null;}super.handleOnDestroy();}
}
