// Renders Loupe's app icons: swift make-icons.swift <outdir>
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

func render(size: Int, maskable: Bool, to path: String) {
  let s = CGFloat(size)
  let cs = CGColorSpaceCreateDeviceRGB()
  guard let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: cs,
                            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { fatalError("ctx") }
  // Maskable icons must be full-bleed; normal icons get rounded corners.
  let bg = CGRect(x: 0, y: 0, width: s, height: s)
  let path0 = maskable ? CGPath(rect: bg, transform: nil)
                       : CGPath(roundedRect: bg.insetBy(dx: s * 0.04, dy: s * 0.04), cornerWidth: s * 0.22, cornerHeight: s * 0.22, transform: nil)
  ctx.addPath(path0)
  ctx.clip()
  let grad = CGGradient(colorsSpace: cs, colors: [
    CGColor(red: 0.42, green: 0.62, blue: 1.0, alpha: 1),
    CGColor(red: 0.16, green: 0.33, blue: 0.86, alpha: 1),
  ] as CFArray, locations: [0, 1])!
  ctx.drawLinearGradient(grad, start: CGPoint(x: 0, y: s), end: CGPoint(x: s, y: 0), options: [])

  // Glyph: magnifier. Maskable icons keep it inside the 80% safe zone.
  let scale: CGFloat = maskable ? 0.62 : 0.78
  ctx.translateBy(x: s / 2, y: s / 2)
  ctx.scaleBy(x: s * scale / 24, y: -s * scale / 24) // 24-unit glyph space, y down
  ctx.translateBy(x: -12, y: -12)
  ctx.setStrokeColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
  ctx.setLineCap(.round)
  ctx.setLineWidth(2.4)
  ctx.strokeEllipse(in: CGRect(x: 3.2, y: 3.2, width: 12.6, height: 12.6))
  ctx.setLineWidth(3.0)
  ctx.move(to: CGPoint(x: 14.6, y: 14.6))
  ctx.addLine(to: CGPoint(x: 20.6, y: 20.6))
  ctx.strokePath()
  // A small crop mark inside the lens.
  ctx.setLineWidth(1.5)
  ctx.move(to: CGPoint(x: 7.2, y: 6.6)); ctx.addLine(to: CGPoint(x: 7.2, y: 11.8)); ctx.addLine(to: CGPoint(x: 12.4, y: 11.8))
  ctx.move(to: CGPoint(x: 6.6, y: 7.2)); ctx.addLine(to: CGPoint(x: 11.8, y: 7.2)); ctx.addLine(to: CGPoint(x: 11.8, y: 12.4))
  ctx.strokePath()

  let img = ctx.makeImage()!
  let url = URL(fileURLWithPath: path)
  let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, img, nil)
  CGImageDestinationFinalize(dest)
}

let out = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "."
render(size: 192, maskable: false, to: "\(out)/icon-192.png")
render(size: 512, maskable: false, to: "\(out)/icon-512.png")
render(size: 512, maskable: true, to: "\(out)/icon-maskable-512.png")
render(size: 180, maskable: true, to: "\(out)/apple-touch-icon.png")
print("ok")
