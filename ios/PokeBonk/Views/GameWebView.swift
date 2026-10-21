import SwiftUI
import WebKit

struct GameWebView: UIViewRepresentable {
    private let gameUrl = URL(string: "https://pokebonk.com")!
    @Binding var isOffline: Bool

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        if #available(iOS 15.4, *) {
            config.preferences.isElementFullscreenEnabled = true
        }

        // 1. Inject Theme CSS from Bundle
        if let cssUrl = Bundle.main.url(forResource: "pokebonk-theme", withExtension: "css"),
           let cssText = try? String(contentsOf: cssUrl, encoding: .utf8) {
            let cssScript = """
            (function() {
                const style = document.createElement('style');
                style.id = 'pb-ios-core-theme';
                style.textContent = `\(cssText.replacingOccurrences(of: "`", with: "\\`"))`;
                document.head.appendChild(style);
            })();
            """
            let userCss = WKUserScript(source: cssScript, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
            config.userContentController.addUserScript(userCss)
        }

        // 2. Inject Core Engine JS from Bundle
        if let jsUrl = Bundle.main.url(forResource: "pokebonk-core", withExtension: "js"),
           let jsText = try? String(contentsOf: jsUrl, encoding: .utf8) {
            let userJs = WKUserScript(source: jsText, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
            config.userContentController.addUserScript(userJs)
        }

        // 3. Message handler for Native Bridge
        config.userContentController.add(context.coordinator, name: "pokeBonkIOS")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.backgroundColor = .black
        webView.isOpaque = true
        webView.scrollView.backgroundColor = .black
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never

        // Modern Mobile Safari UA
        let mobileUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
        webView.customUserAgent = mobileUA

        let request = URLRequest(url: gameUrl, cachePolicy: .useProtocolCachePolicy, timeoutInterval: 25.0)
        webView.load(request)

        context.coordinator.webView = webView
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        var parent: GameWebView
        weak var webView: WKWebView?

        init(_ parent: GameWebView) {
            self.parent = parent
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let dict = message.body as? [String: Any],
                  let action = dict["action"] as? String else { return }

            if action == "checkUpdate" {
                if let url = URL(string: "https://github.com/JOWEND04/unofficial_pokebonk_app/releases/latest") {
                    UIApplication.shared.open(url)
                }
            }
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.allow)
                return
            }

            let host = (url.host ?? "").lowercased()
            let internalHosts = ["pokebonk.com", "solais.cloud"]

            if internalHosts.isEmpty || internalHosts.contains(where: { host.contains($0) }) {
                decisionHandler(.allow)
                return
            }

            // Open external links (Discord, GitHub, external auth) in system Safari
            if ["http", "https"].contains(url.scheme?.lowercased()) {
                UIApplication.shared.open(url, options: [:], completionHandler: nil)
                decisionHandler(.cancel)
                return
            }

            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            DispatchQueue.main.async {
                self.parent.isOffline = false
            }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            handleError(error)
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            handleError(error)
        }

        private func handleError(_ error: Error) {
            let nsError = error as NSError
            if nsError.code != NSURLErrorCancelled {
                DispatchQueue.main.async {
                    self.parent.isOffline = true
                }
            }
        }
    }
}
