// Prints the id of the biggest window of a process, for `screencapture -l`.
import CoreGraphics
import Foundation

let want = Int32(CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "0") ?? 0
// Only a window that is on screen has anything to capture; the others of the process come out blank.
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as! [[String: Any]]
for window in list {
  let pid = window["kCGWindowOwnerPID"] as? Int32 ?? 0
  let bounds = window["kCGWindowBounds"] as? [String: Any] ?? [:]
  let height = (bounds["Height"] as? Double) ?? 0
  if pid == want && height > 200 {
    print(window["kCGWindowNumber"]!)
    break
  }
}
