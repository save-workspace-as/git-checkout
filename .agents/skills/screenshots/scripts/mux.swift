// Puts narration clips on a screen recording: mux <video.mov> <out.mp4> <offsetSeconds> <clip.aiff> [<offset> <clip>...]
import AVFoundation
import Foundation

let args = CommandLine.arguments
guard args.count >= 5, args.count % 2 == 1 else { print("usage: mux video out.mp4 offset clip ..."); exit(2) }
let video = AVURLAsset(url: URL(fileURLWithPath: args[1]))
let composition = AVMutableComposition()
let duration = try await video.load(.duration)
if let source = try await video.loadTracks(withMediaType: .video).first,
   let track = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) {
  try track.insertTimeRange(CMTimeRange(start: .zero, duration: duration), of: source, at: .zero)
  track.preferredTransform = try await source.load(.preferredTransform)
}
// One audio track per clip: clips of one track would have to be laid end to end.
var index = 3
while index + 1 < args.count {
  let clip = AVURLAsset(url: URL(fileURLWithPath: args[index + 1]))
  if let source = try await clip.loadTracks(withMediaType: .audio).first,
     let track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) {
    let length = try await clip.load(.duration)
    try track.insertTimeRange(CMTimeRange(start: .zero, duration: length), of: source, at: CMTime(seconds: Double(args[index]) ?? 0, preferredTimescale: 600))
  }
  index += 2
}
let output = URL(fileURLWithPath: args[2])
try? FileManager.default.removeItem(at: output)
guard let export = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else { print("no exporter"); exit(1) }
try await export.export(to: output, as: .mp4)
print("wrote \(output.path)")
