import Foundation
import GameController
import Combine

final class GamepadManager: ObservableObject {
    static let shared = GamepadManager()

    @Published var isControllerConnected: Bool = false
    @Published var controllerName: String = ""

    private var cancellables = Set<AnyCancellable>()

    private init() {}

    func startMonitoring() {
        NotificationCenter.default.publisher(for: .GCControllerDidConnect)
            .sink { [weak self] notification in
                guard let controller = notification.object as? GCController else { return }
                self?.handleControllerConnected(controller)
            }
            .store(in: &cancellables)

        NotificationCenter.default.publisher(for: .GCControllerDidDisconnect)
            .sink { [weak self] notification in
                guard let controller = notification.object as? GCController else { return }
                self?.handleControllerDisconnected(controller)
            }
            .store(in: &cancellables)

        // Check if any controller is already connected
        if let first = GCController.controllers().first {
            handleControllerConnected(first)
        }
    }

    private func handleControllerConnected(_ controller: GCController) {
        let name = controller.vendorName ?? "Wireless Gamepad"
        DispatchQueue.main.async {
            self.isControllerConnected = true
            self.controllerName = name
            print("[PokéBonk iOS] Controller connected: \(name)")
        }
    }

    private func handleControllerDisconnected(_ controller: GCController) {
        let remaining = GCController.controllers()
        DispatchQueue.main.async {
            self.isControllerConnected = !remaining.isEmpty
            self.controllerName = remaining.first?.vendorName ?? ""
            print("[PokéBonk iOS] Controller disconnected")
        }
    }
}
