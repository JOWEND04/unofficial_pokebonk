import SwiftUI

struct ContentView: View {
    @StateObject private var gamepadManager = GamepadManager.shared

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            GameWebView()
                .ignoresSafeArea()
        }
        .background(Color.black)
        .preferredColorScheme(.dark)
        .onAppear {
            gamepadManager.startMonitoring()
        }
    }
}

#Preview {
    ContentView()
}
