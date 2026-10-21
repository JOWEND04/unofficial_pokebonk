import SwiftUI
import UIKit

@main
struct PokeBonkApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        WindowGroup {
            Group {
                if #available(iOS 16.0, *) {
                    ContentView()
                        .ignoresSafeArea(.all)
                        .persistentSystemOverlays(.hidden)
                } else {
                    ContentView()
                        .ignoresSafeArea(.all)
                }
            }
            .statusBar(hidden: true)
        }
    }
}

class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Prevent screen from sleeping during gameplay
        UIApplication.shared.isIdleTimerDisabled = true
        return true
    }

    func application(
        _ application: UIApplication,
        supportedInterfaceOrientationsFor window: UIWindow?
    ) -> UIInterfaceOrientationMask {
        return .landscape
    }
}
