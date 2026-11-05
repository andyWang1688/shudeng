/** Same 8px smooth wave and 1.6px stroke as the native note decoration. */
export function drawNoteWave(rects: readonly DOMRect[], options: { color?: string } = {}): SVGElement {
  const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  group.setAttribute('fill', 'none')
  group.setAttribute('stroke', options.color ?? '#8A5413')
  group.setAttribute('stroke-width', '1.6')
  group.setAttribute('stroke-linecap', 'round')
  for (const rect of rects) {
    if (rect.width <= 0) continue
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
    let d = 'M' + rect.left + ' ' + (rect.bottom - 1)
    for (let x = 0; x < rect.width; x += 8) {
      const width = Math.min(8, rect.width - x)
      d += 'q' + width / 4 + ' -2.5 ' + width / 2 + ' 0t' + width / 2 + ' 0'
    }
    path.setAttribute('d', d)
    group.append(path)
  }
  return group
}
