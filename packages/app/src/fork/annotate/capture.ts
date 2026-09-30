// fork: pixel capture for annotate regions (v1 behaviour). Media elements are read directly; everything
// else (the PDF viewer, sandboxed HTML, rendered documents) is opaque to canvas, so those pixels come from
// a capture of the current tab. One stream is reused so the browser asks for permission once.
let stream: MediaStream | undefined
let frame: HTMLVideoElement | undefined

/** Crop the viewport rectangle `rect` out of whatever is rendered inside `container`. */
export async function captureRegion(container: HTMLElement, rect: DOMRect) {
  const media = mediaAt(container, rect)
  if (media) return cropMedia(media, rect)
  return cropDisplay(rect)
}

function mediaAt(container: HTMLElement, rect: DOMRect) {
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2
  return Array.from(container.querySelectorAll<HTMLImageElement | HTMLVideoElement>("img, video")).find((element) => {
    const bounds = element.getBoundingClientRect()
    return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom
  })
}

function cropMedia(element: HTMLImageElement | HTMLVideoElement, rect: DOMRect) {
  const bounds = element.getBoundingClientRect()
  const natural =
    element instanceof HTMLVideoElement
      ? { width: element.videoWidth, height: element.videoHeight }
      : { width: element.naturalWidth, height: element.naturalHeight }
  if (!natural.width || !natural.height || !bounds.width || !bounds.height) return Promise.resolve(undefined)
  const scaleX = natural.width / bounds.width
  const scaleY = natural.height / bounds.height
  return crop(
    element,
    (Math.max(rect.left, bounds.left) - bounds.left) * scaleX,
    (Math.max(rect.top, bounds.top) - bounds.top) * scaleY,
    (Math.min(rect.right, bounds.right) - Math.max(rect.left, bounds.left)) * scaleX,
    (Math.min(rect.bottom, bounds.bottom) - Math.max(rect.top, bounds.top)) * scaleY,
  )
}

async function cropDisplay(rect: DOMRect) {
  const video = await displayFrame()
  if (!video) return
  const scaleX = video.videoWidth / window.innerWidth
  const scaleY = video.videoHeight / window.innerHeight
  return crop(video, rect.left * scaleX, rect.top * scaleY, rect.width * scaleX, rect.height * scaleY)
}

async function displayFrame() {
  const live = stream?.getVideoTracks().some((track) => track.readyState === "live")
  if (!live) {
    if (!navigator.mediaDevices?.getDisplayMedia) return
    // preferCurrentTab is a Chromium extension that pre-selects this tab in the share picker.
    const options = { video: true, audio: false, preferCurrentTab: true } as DisplayMediaStreamOptions
    stream = await navigator.mediaDevices.getDisplayMedia(options).catch(() => undefined)
    if (!stream) return
    frame = undefined
  }
  if (!frame) {
    frame = document.createElement("video")
    frame.muted = true
    frame.srcObject = stream!
    await frame.play().catch(() => undefined)
  }
  const video = frame
  if (video.readyState < 2) await new Promise((resolve) => (video.onloadeddata = resolve))
  return video
}

function crop(source: CanvasImageSource, sx: number, sy: number, sw: number, sh: number) {
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(sw))
  canvas.height = Math.max(1, Math.round(sh))
  const context = canvas.getContext("2d")
  if (!context) return Promise.resolve(undefined)
  context.drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  return new Promise<Blob | undefined>((resolve) => canvas.toBlob((blob) => resolve(blob ?? undefined), "image/png"))
}
