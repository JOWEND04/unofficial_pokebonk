import SwiftUI

struct ContentView: View {
    @StateObject private var gamepadManager = GamepadManager.shared
    @State private var isOffline: Bool = false
    @State private var reloadToken: UUID = UUID()

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            GameWebView(isOffline: $isOffline)
                .id(reloadToken)
                .ignoresSafeArea()

            if isOffline {
                ZStack {
                    Color(red: 0.05, green: 0.04, blue: 0.1)
                        .ignoresSafeArea()

                    VStack(spacing: 16) {
                        Image(systemName: "wifi.slash")
                            .font(.system(size: 48, weight: .semibold))
                            .foregroundColor(Color(red: 1.0, green: 0.8, blue: 0.2))

                        Text("Connection Lost")
                            .font(.system(size: 20, weight: .bold))
                            .foregroundColor(.white)

                        Text("Could not reach PokéBonk servers. Please check your internet connection.")
                            .font(.system(size: 14))
                            .foregroundColor(.gray)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 32)

                        Button(action: {
                            isOffline = false
                            reloadToken = UUID()
                            let generator = UIImpactFeedbackGenerator(style: .medium)
                            generator.impactOccurred()
                        }) {
                            Text("Retry Connection")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundColor(.black)
                                .padding(.horizontal, 24)
                                .padding(.vertical, 12)
                                .background(Color(red: 1.0, green: 0.8, blue: 0.2))
                                .cornerRadius(999)
                        }
                        .padding(.top, 8)
                    }
                }
                .transition(.opacity)
            }
        }
        .background(Color.black)
        .preferredColorScheme(.dark)
        .onAppear {
            gamepadManager.startMonitoring()
        }
    }
}

#if DEBUG
struct ContentView_Previews: PreviewProvider {
    static var previews: some View {
        ContentView()
    }
}
#endif
