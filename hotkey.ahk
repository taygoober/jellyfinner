#Requires AutoHotkey v2.0

; Press Esc at any time to quit the script.
Esc::{
    ExitApp()
}

; Wait 2 hours 30 minutes
Sleep(9000000)  ; 2.5 hours

; Press Enter
Send("{Enter}")

; Wait another 4 hours 45 minutes
Sleep(17100000) ; Total elapsed = 7 hours 15 minutes

; Type "continue" and press Enter
Send("continue")
Sleep(90)
Send("{Enter}")