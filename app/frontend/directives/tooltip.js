let _tooltipEl = null
let _tooltipTimer = null

function showTooltip(text, event) {
  if (!text) return
  if (!_tooltipEl) {
    _tooltipEl = document.createElement('div')
    _tooltipEl.className = 'x-tooltip'
    document.body.appendChild(_tooltipEl)
  }
  _tooltipEl.textContent = text
  positionTooltip(event)
  _tooltipTimer = setTimeout(() => {
    if (_tooltipEl) _tooltipEl.classList.add('visible')
  }, 150)
}

function positionTooltip(event) {
  if (!_tooltipEl) return
  const margin = 10
  const tw = _tooltipEl.offsetWidth || 200
  const th = _tooltipEl.offsetHeight || 28
  let x = event.clientX + margin
  let y = event.clientY - th - margin
  if (x + tw > window.innerWidth) x = event.clientX - tw - margin
  if (y < 0) y = event.clientY + margin
  _tooltipEl.style.left = x + 'px'
  _tooltipEl.style.top = y + 'px'
}

function hideTooltip() {
  clearTimeout(_tooltipTimer)
  if (_tooltipEl) _tooltipEl.classList.remove('visible')
}

export const tooltipDirective = {
  mounted(el, binding) {
    el.__tooltip_text = binding.value
    el.__tooltip_mouseover = (e) => showTooltip(el.__tooltip_text, e)
    el.__tooltip_mousemove = (e) => positionTooltip(e)
    el.__tooltip_mouseleave = () => hideTooltip()
    el.addEventListener('mouseover', el.__tooltip_mouseover)
    el.addEventListener('mousemove', el.__tooltip_mousemove)
    el.addEventListener('mouseleave', el.__tooltip_mouseleave)
  },
  updated(el, binding) {
    el.__tooltip_text = binding.value
  },
  unmounted(el) {
    el.removeEventListener('mouseover', el.__tooltip_mouseover)
    el.removeEventListener('mousemove', el.__tooltip_mousemove)
    el.removeEventListener('mouseleave', el.__tooltip_mouseleave)
    hideTooltip()
  },
}
