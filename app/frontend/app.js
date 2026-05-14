import NodesSidebar from './components/NodesSidebar.js'
import ChatView from './components/ChatView.js'
import ConnectionDialog from './components/ConnectionDialog.js'
import SettingsDialog from './components/SettingsDialog.js'
import UpdateDialog from './components/UpdateDialog.js'
import DeviceConfigPanel from './components/DeviceConfigPanel.js'

const { createApp } = Vue

const App = {
  components: { NodesSidebar, ChatView, ConnectionDialog, SettingsDialog, UpdateDialog, DeviceConfigPanel },

  data() {
    return {
      connectedNodes: [],
      activeNodeId: null,
      meshNodes: [],
      activeContactKey: null,
      channels: [],
      showConnectionDialog: false,
      showSettingsDialog: false,
      showDeviceConfig: false,
      deviceConfigNodeId: null,
      updateVersion: null,
      mirrorConnected: false,
      mirrorMessages: {},
      relayInfo: {},
      unreadChannels: {},
      dmTabs: [],
      unreadDms: {},
      unreadByNode: {},
      sidebarInfoNode: null,
      nodeModalView: 'info',
      tracerouteHistory: [],
      traceroutePending: false,
      ilyaDumovMode: localStorage.getItem('ilya_dumov_mode') === '1',
      sidebarWidth: parseInt(localStorage.getItem('sidebar_width') || '280', 10),
    }
  },

  async mounted() {
    document.documentElement.style.setProperty('--sidebar-width', this.sidebarWidth + 'px')

    // Wait for pywebview to be ready
    await this.waitForApi()

    // Register global event handler from Python
    window.__onMeshEvent = (data) => this.handleMeshEvent(data)

    // Restore previously connected nodes
    this.connectedNodes = await window.pywebview.api.get_connected_nodes()
    this.activeNodeId = await window.pywebview.api.get_active_node()
    const mirrorStatus = await window.pywebview.api.get_mirror_status()
    this.mirrorConnected = mirrorStatus.connected

    if (this.activeNodeId) {
      this.meshNodes = await window.pywebview.api.get_nodes()
      this.channels = await window.pywebview.api.get_channels()
      this.activeContactKey = `${this.channels[0]?.index ?? 0}_^all`
    }

    setInterval(async () => {
      if (window.pywebview?.api && this.activeNodeId) {
        this.meshNodes = await window.pywebview.api.get_nodes()
      }
    }, 5000)
  },

  methods: {
    startSidebarResize(e) {
      const startX = e.clientX
      const startWidth = this.sidebarWidth
      const onMove = (ev) => {
        const w = Math.min(400, Math.max(160, startWidth + ev.clientX - startX))
        this.sidebarWidth = w
        document.documentElement.style.setProperty('--sidebar-width', w + 'px')
      }
      const onUp = () => {
        localStorage.setItem('sidebar_width', this.sidebarWidth)
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },

    async waitForApi() {
      return new Promise(resolve => {
        const check = () => {
          if (window.pywebview?.api) return resolve()
          setTimeout(check, 50)
        }
        check()
      })
    },

    async onNodeConnected({ nodeId }) {
      if (!this.connectedNodes.includes(nodeId)) {
        this.connectedNodes.push(nodeId)
      }
      await this.setActiveNode(nodeId)
    },

    async disconnectNode(nodeId) {
      await window.pywebview.api.disconnect_node(nodeId)
    },

    async setActiveNode(nodeId) {
      await window.pywebview.api.set_active_node(nodeId)
      this.activeNodeId = nodeId
      this.meshNodes = await window.pywebview.api.get_nodes()
      this.channels = await window.pywebview.api.get_channels()
      this.activeContactKey = `${this.channels[0]?.index ?? 0}_^all`
      this.dmTabs = []
      this.unreadDms = {}
      this.unreadChannels = {}
      this.$set ? this.$set(this.unreadByNode, nodeId, 0) : (this.unreadByNode[nodeId] = 0)
    },

    openDm(node) {
      const ck = `0_${node.node_id}`
      if (!this.dmTabs.find(t => t.node_id === node.node_id)) {
        this.dmTabs.push({ node_id: node.node_id, name: node.long_name || node.short_name || node.node_id })
      }
      this.activeContactKey = ck
      delete this.unreadDms[ck]
    },

    closeDm(nodeId) {
      this.dmTabs = this.dmTabs.filter(t => t.node_id !== nodeId)
      const ck = `0_${nodeId}`
      delete this.unreadDms[ck]
      if (this.activeContactKey === ck) {
        this.activeContactKey = `${this.channels[0]?.index ?? 0}_^all`
      }
    },

    handleMeshEvent(data) {
      const { event, payload } = data
      console.log('[mesh]', event, JSON.stringify(payload).slice(0, 120))
      switch (event) {
        case 'message.new':
          if (payload.message.source === 'mirror') {
            const ck = payload.message.contact_key
            if (!this.mirrorMessages[ck]) this.mirrorMessages[ck] = []
            const arr = this.mirrorMessages[ck]
            if (!arr.some(m => m.packet_id === payload.message.packet_id)) {
              arr.push(payload.message)
            }
          } else if (payload.node_id !== this.activeNodeId) {
            // Message from a background connected node — show unread badge only
            this.unreadByNode[payload.node_id] = (this.unreadByNode[payload.node_id] || 0) + 1
          } else {
            const msgCk = payload.message.contact_key || ''
            const isDm = msgCk && !msgCk.endsWith('_^all')
            if (isDm) {
              // Auto-open DM tab for incoming personal messages addressed to us
              const fromNodeId = payload.message.from_node_id
              if (fromNodeId && fromNodeId !== this.activeNodeId && !this.dmTabs.find(t => t.node_id === fromNodeId)) {
                const node = this.meshNodes.find(n => n.node_id === fromNodeId) || {}
                this.dmTabs.push({ node_id: fromNodeId, name: node.long_name || node.short_name || fromNodeId })
              }
              // Play notification sound for incoming DMs from others
              if (payload.message.from_node_id !== this.activeNodeId) {
                this.playDmSound()
              }
            }
            this.$refs.chat?.onNewMessage(payload.message)
            if (msgCk !== this.activeContactKey) {
              if (isDm) {
                this.unreadDms[msgCk] = (this.unreadDms[msgCk] || 0) + 1
              } else {
                const chIdx = parseInt(msgCk.split('_')[0])
                if (!isNaN(chIdx)) {
                  this.unreadChannels[chIdx] = (this.unreadChannels[chIdx] || 0) + 1
                }
              }
            }
          }
          break
        case 'message.ack':
          if (payload.node_id === this.activeNodeId) {
            this.$refs.chat?.onMessageAck(payload.packet_id, payload.status)
          }
          break
        case 'reaction.new':
          if (payload.node_id === this.activeNodeId) {
            this.$refs.chat?.onNewReaction(payload)
          }
          break
        case 'node.connected':
          if (!this.connectedNodes.includes(payload.node_id)) {
            this.connectedNodes.push(payload.node_id)
          }
          break
        case 'node.disconnected':
          this.connectedNodes = this.connectedNodes.filter(id => id !== payload.node_id)
          delete this.unreadByNode[payload.node_id]
          if (this.activeNodeId === payload.node_id) {
            const next = this.connectedNodes[0] ?? null
            this.activeNodeId = next
            this.meshNodes = []
            this.channels = []
            this.activeContactKey = null
            this.dmTabs = []
            this.unreadDms = {}
            this.unreadChannels = {}
            if (next) this.setActiveNode(next)
          }
          break
        case 'node.updated':
          if (payload.node_id === this.activeNodeId) {
            this.updateMeshNode(payload.node)
          }
          break
        case 'mirror.connected':
          this.mirrorConnected = true
          break
        case 'mirror.disconnected':
          this.mirrorConnected = false
          this.mirrorMessages = {}
          this.relayInfo = {}
          break
        case 'relay.info':
          this.relayInfo[payload.packet_id] = {
            mirror_msg_id: payload.mirror_msg_id,
            count: payload.relay_count,
          }
          break
        case 'relay.update':
          if (this.relayInfo[payload.packet_id]) {
            this.relayInfo[payload.packet_id].count = payload.relay_count
            if (payload.mirror_msg_id && !this.relayInfo[payload.packet_id].mirror_msg_id) {
              this.relayInfo[payload.packet_id].mirror_msg_id = payload.mirror_msg_id
            }
          } else {
            this.relayInfo[payload.packet_id] = { mirror_msg_id: payload.mirror_msg_id || null, count: payload.relay_count }
          }
          break
        case 'update.available':
          this.updateVersion = payload.version
          break
        case 'traceroute.timeout':
          this.traceroutePending = false
          if (this.sidebarInfoNode && this.sidebarInfoNode.node_id === payload.dest_node_id) {
            const entry = this.tracerouteHistory.find(t => t.id === payload.request_id)
            if (entry) {
              entry.timed_out = true
              entry.completed_at = new Date().toISOString()
            }
          }
          break
        case 'traceroute.result':
          this.traceroutePending = false
          if (this.sidebarInfoNode && this.sidebarInfoNode.node_id === payload.dest_node_id) {
            this.tracerouteHistory.unshift({
              id: payload.request_id,
              forward_route: payload.forward_route,
              return_route: payload.return_route,
              requested_at: new Date().toISOString(),
              completed_at: new Date().toISOString(),
            })
            this.nodeModalView = 'traceroute'
          }
          break
      }
    },

    async toggleMirror() {
      if (this.mirrorConnected) {
        await window.pywebview.api.disconnect_mirror()
      } else {
        await window.pywebview.api.connect_mirror()
      }
    },

    async reloadNodes() {
      if (this.activeNodeId) {
        this.meshNodes = await window.pywebview.api.get_nodes()
      }
    },

    reloadChat() {
      this.$refs.chat?.loadMessages()
    },

    playDmSound() {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)()
        const t = ctx.currentTime
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.type = 'sine'
        osc.frequency.setValueAtTime(880, t)
        osc.frequency.exponentialRampToValueAtTime(660, t + 0.12)
        gain.gain.setValueAtTime(0.3, t)
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35)
        osc.start(t)
        osc.stop(t + 0.35)
      } catch (_) {}
    },

    formatUptime(seconds) {
      const h = Math.floor(seconds / 3600)
      const m = Math.floor((seconds % 3600) / 60)
      return h > 0 ? `${h}ч ${m}м` : `${m}м`
    },

    formatLastSeen(ts) {
      return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    },

    updateMeshNode(node) {
      const idx = this.meshNodes.findIndex(n => n.node_id === node.node_id)
      if (idx === -1) {
        this.meshNodes = [...this.meshNodes, node]
      } else {
        this.meshNodes = this.meshNodes.map((n, i) => i === idx ? node : n)
      }
    },

    async showNodeInfo(node) {
      const full = this.meshNodes.find(n => n.node_id === node.node_id)
      this.sidebarInfoNode = full || node
      this.nodeModalView = 'info'
      this.tracerouteHistory = []
      this.traceroutePending = false
      if (window.pywebview?.api) {
        this.tracerouteHistory = await window.pywebview.api.get_traceroute_history(node.node_id)
      }
    },

    async showTracerouteHistory() {
      this.nodeModalView = 'traceroute'
      if (this.sidebarInfoNode && window.pywebview?.api) {
        this.tracerouteHistory = await window.pywebview.api.get_traceroute_history(this.sidebarInfoNode.node_id)
      }
    },

    async exchangeUserInfo(node) {
      const res = await window.pywebview.api.request_user_info(node.node_id)
      if (res.error) console.error('request_user_info:', res.error)
    },

    async traceRoute(node) {
      this.traceroutePending = true
      const res = await window.pywebview.api.send_traceroute(node.node_id)
      if (res.error) {
        this.traceroutePending = false
        console.error('send_traceroute:', res.error)
      }
    },

    async toggleFavorite(node) {
      const newVal = !node.is_favorite
      const res = await window.pywebview.api.set_node_favorite(node.node_id, newVal)
      if (!res.error) {
        node.is_favorite = newVal
        this.updateMeshNode({ ...node })
      }
    },

    async toggleIgnore(node) {
      const newVal = !node.is_ignored
      const res = await window.pywebview.api.set_node_ignored(node.node_id, newVal)
      if (!res.error) {
        node.is_ignored = newVal
        this.updateMeshNode({ ...node })
      }
    },

    openDeviceConfig(nodeId) {
      this.deviceConfigNodeId = nodeId
      this.showDeviceConfig = true
    },

    async confirmDeleteNode(node) {
      if (!confirm(`Удалить ноду ${node.long_name || node.node_id}?`)) return
      const res = await window.pywebview.api.delete_node(node.node_id)
      if (!res.error) {
        this.meshNodes = this.meshNodes.filter(n => n.node_id !== node.node_id)
        this.sidebarInfoNode = null
      }
    },
  },

  template: `
    <div class="app-layout">
      <NodesSidebar
        :connected-nodes="connectedNodes"
        :active-node-id="activeNodeId"
        :mesh-nodes="meshNodes"
        :mirror-connected="mirrorConnected"
        :unread-by-node="unreadByNode"
        @select-node="setActiveNode"
        @add-node="showConnectionDialog = true"
        @open-settings="showSettingsDialog = true"
        @toggle-mirror="toggleMirror"
        @open-dm="openDm"
        @show-node-info="showNodeInfo"
        @disconnect-node="disconnectNode"
        @open-device-config="openDeviceConfig"
      />

      <div class="sidebar-resizer" @mousedown.prevent="startSidebarResize"></div>

      <main class="main-area">
        <div v-if="!activeNodeId" class="empty-state">
          <p>Подключите ноду для начала работы</p>
          <button class="btn-primary" @click="showConnectionDialog = true">Подключить</button>
        </div>

        <ChatView
          v-else
          :key="activeNodeId"
          ref="chat"
          :contact-key="activeContactKey"
          :active-node-id="activeNodeId"
          :mesh-nodes="meshNodes"
          :channels="channels"
          :mirror-msgs="mirrorMessages[activeContactKey] || []"
          :relay-info="relayInfo"
          :unread-channels="unreadChannels"
          :dm-tabs="dmTabs"
          :unread-dms="unreadDms"
          :ilya-dumov-mode="ilyaDumovMode"
          @channel-change="ch => { activeContactKey = ch.index + '_^all'; delete unreadChannels[ch.index] }"
          @dm-change="ck => { activeContactKey = ck; delete unreadDms[ck] }"
          @dm-close="closeDm"
          @show-node-info="showNodeInfo"
        />
      </main>

      <ConnectionDialog
        v-if="showConnectionDialog"
        @connected="onNodeConnected"
        @close="showConnectionDialog = false"
      />

      <SettingsDialog
        v-if="showSettingsDialog"
        :active-contact-key="activeContactKey"
        :ilya-dumov-mode="ilyaDumovMode"
        @close="showSettingsDialog = false"
        @nodes-updated="reloadNodes"
        @chat-cleared="reloadChat"
        @update:ilya-dumov-mode="v => { ilyaDumovMode = v; localStorage.setItem('ilya_dumov_mode', v ? '1' : '0') }"
      />

      <UpdateDialog
        v-if="updateVersion"
        :version="updateVersion"
        @close="updateVersion = null"
      />

      <DeviceConfigPanel
        v-if="showDeviceConfig"
        :node-id="deviceConfigNodeId"
        @close="showDeviceConfig = false"
      />

      <!-- Node info modal (from sidebar) -->
      <div v-if="sidebarInfoNode" class="node-info-overlay" @click.self="sidebarInfoNode = null">
        <div class="node-info-modal">
          <button class="node-info-close" @click="sidebarInfoNode = null">✕</button>
          <h3>{{ sidebarInfoNode.long_name || sidebarInfoNode.short_name || sidebarInfoNode.node_id }}</h3>
          <div class="node-action-buttons">
            <button @click="exchangeUserInfo(sidebarInfoNode)" title="Запросить информацию о ноде">🔄</button>
            <button @click="traceRoute(sidebarInfoNode)" :class="{ pending: traceroutePending }" title="Трассировка маршрута">{{ traceroutePending ? '⏳' : '🔀' }}</button>
            <button @click="toggleFavorite(sidebarInfoNode)" :class="{ active: sidebarInfoNode.is_favorite }" :title="sidebarInfoNode.is_favorite ? 'Убрать из избранного' : 'Добавить в избранное'">{{ sidebarInfoNode.is_favorite ? '⛔️' : '⭐️' }}</button>
            <button @click="toggleIgnore(sidebarInfoNode)" :class="{ active: sidebarInfoNode.is_ignored }" :title="sidebarInfoNode.is_ignored ? 'Снять игнор' : 'Игнорировать ноду'">🚫</button>
            <button @click="confirmDeleteNode(sidebarInfoNode)" class="danger" title="Удалить ноду">🚮</button>
            <div class="node-action-sep"></div>
            <button @click="nodeModalView = 'info'" :class="{ active: nodeModalView === 'info' }" title="Информация о ноде">ℹ️</button>
            <button @click="showTracerouteHistory()" :class="{ active: nodeModalView === 'traceroute' }" title="История трассировок">🔂</button>
          </div>

          <!-- Info view -->
          <table v-if="nodeModalView === 'info'" class="node-info-table">
            <tr v-if="sidebarInfoNode.node_id"><td>ID</td><td>{{ sidebarInfoNode.node_id }}</td></tr>
            <tr v-if="sidebarInfoNode.short_name"><td>Short name</td><td>{{ sidebarInfoNode.short_name }}</td></tr>
            <tr v-if="sidebarInfoNode.long_name"><td>Long name</td><td>{{ sidebarInfoNode.long_name }}</td></tr>
            <tr v-if="sidebarInfoNode.hw_model"><td>Железо</td><td>{{ sidebarInfoNode.hw_model }}</td></tr>
            <tr v-if="sidebarInfoNode.role"><td>Роль</td><td>{{ sidebarInfoNode.role }}</td></tr>
            <tr v-if="sidebarInfoNode.city"><td>Город</td><td>{{ sidebarInfoNode.city }}</td></tr>
            <tr v-if="sidebarInfoNode.firmware_version"><td>Прошивка</td><td>{{ sidebarInfoNode.firmware_version }}</td></tr>
            <tr v-if="sidebarInfoNode.latitude != null"><td>Координаты</td><td>{{ sidebarInfoNode.latitude }}, {{ sidebarInfoNode.longitude }}</td></tr>
            <tr v-if="sidebarInfoNode.altitude != null"><td>Высота</td><td>{{ sidebarInfoNode.altitude }} м</td></tr>
            <tr v-if="sidebarInfoNode.battery_level != null"><td>Батарея</td><td>{{ parseFloat(sidebarInfoNode.battery_level).toFixed(1) }}%</td></tr>
            <tr v-if="sidebarInfoNode.voltage != null"><td>Напряжение</td><td>{{ parseFloat(sidebarInfoNode.voltage).toFixed(1) }} В</td></tr>
            <tr v-if="sidebarInfoNode.channel_utilization != null"><td>Загр. канала</td><td>{{ parseFloat(sidebarInfoNode.channel_utilization).toFixed(1) }}%</td></tr>
            <tr v-if="sidebarInfoNode.air_util_tx != null"><td>Air util TX</td><td>{{ parseFloat(sidebarInfoNode.air_util_tx).toFixed(1) }}%</td></tr>
            <tr v-if="sidebarInfoNode.uptime_seconds != null"><td>Аптайм</td><td>{{ formatUptime(sidebarInfoNode.uptime_seconds) }}</td></tr>
            <tr v-if="sidebarInfoNode.snr != null"><td>Последний SNR</td><td>{{ parseFloat(sidebarInfoNode.snr).toFixed(1) }} dB</td></tr>
            <tr v-if="sidebarInfoNode.rssi != null"><td>RSSI</td><td>{{ sidebarInfoNode.rssi }} dBm</td></tr>
            <tr v-if="sidebarInfoNode.temperature != null"><td>Температура</td><td>{{ parseFloat(sidebarInfoNode.temperature).toFixed(1) }} °C</td></tr>
            <tr v-if="sidebarInfoNode.humidity != null"><td>Влажность</td><td>{{ parseFloat(sidebarInfoNode.humidity).toFixed(1) }}%</td></tr>
            <tr v-if="sidebarInfoNode.pressure != null"><td>Давление</td><td>{{ parseFloat(sidebarInfoNode.pressure).toFixed(1) }} гПа</td></tr>
            <tr v-if="sidebarInfoNode.last_seen_at"><td>Последний раз</td><td>{{ formatLastSeen(sidebarInfoNode.last_seen_at) }}</td></tr>
          </table>

          <!-- Traceroute history view -->
          <div v-else-if="nodeModalView === 'traceroute'" class="traceroute-section">
            <div v-if="traceroutePending" class="traceroute-pending">⏳ Трассировка выполняется...</div>
            <div v-if="!tracerouteHistory.length && !traceroutePending" class="traceroute-empty">Нет истории трассировок</div>
            <div v-for="tr in tracerouteHistory" :key="tr.id || tr.requested_at" class="traceroute-entry">
              <div class="traceroute-time">{{ formatLastSeen(tr.requested_at) }}</div>
              <div v-if="!tr.completed_at" class="traceroute-pending">ожидание ответа...</div>
              <div v-else-if="tr.timed_out" class="traceroute-timeout">нет ответа (таймаут)</div>
              <template v-else>
                <div class="traceroute-route">
                  ➡ <span v-for="(hop, i) in tr.forward_route" :key="i">
                    <span v-if="i > 0"> → </span>{{ hop.name || hop.node_id || hop }}<span v-if="hop.snr != null" class="traceroute-snr"> ({{ hop.snr }}dB)</span>
                  </span>
                </div>
                <div class="traceroute-route">
                  ⬅ <span v-for="(hop, i) in tr.return_route" :key="i">
                    <span v-if="i > 0"> → </span>{{ hop.name || hop.node_id || hop }}<span v-if="hop.snr != null" class="traceroute-snr"> ({{ hop.snr }}dB)</span>
                  </span>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
}

// ── Custom tooltip directive ──────────────────────────────────────────────────
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

const tooltipDirective = {
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

createApp(App).directive('tooltip', tooltipDirective).mount('#app')
