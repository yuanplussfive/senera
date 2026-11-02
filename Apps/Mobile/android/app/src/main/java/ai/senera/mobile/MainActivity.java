package ai.senera.mobile;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.webkit.CookieManager;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SeneraDeviceSessionPlugin.class);
        super.onCreate(savedInstanceState);
        // The bundled app and a paired HTTPS server have different sites. Only the
        // dedicated Secure/HttpOnly device cookie opts into cross-site delivery.
        CookieManager.getInstance().setAcceptThirdPartyCookies(getBridge().getWebView(), true);
    }
}
