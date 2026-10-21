package com.unofficial.pokebonk

import android.view.InputDevice
import android.view.KeyEvent
import android.view.MotionEvent

object GamepadHelper {

    fun isGamepadEvent(event: MotionEvent): Boolean {
        val source = event.source
        return (source and InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK ||
                (source and InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD
    }

    fun isGamepadEvent(event: KeyEvent): Boolean {
        val source = event.source
        return (source and InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD ||
                (source and InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK ||
                (source and InputDevice.SOURCE_DPAD) == InputDevice.SOURCE_DPAD
    }
}
