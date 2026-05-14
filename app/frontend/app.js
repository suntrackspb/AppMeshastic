import NodesSidebar from './components/NodesSidebar.js'
import ChatView from './components/ChatView.js'
import ConnectionDialog from './components/ConnectionDialog.js'
import SettingsDialog from './components/SettingsDialog.js'
import UpdateDialog from './components/UpdateDialog.js'
import DeviceConfigPanel from './components/DeviceConfigPanel.js'
import NodeInfoModal from './components/NodeInfoModal.js'
import { tooltipDirective } from './directives/tooltip.js'

const { createApp } = Vue

const App = {
  components: { NodesSidebar, ChatView, ConnectionDialog, SettingsDialog, UpdateDialog, DeviceConfigPanel, NodeInfoModal },

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
    this.connectedNodes = await window.pywebview.api.get_connected_nodes_info()
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

    async onNodeConnected({ nodeId, type }) {
      const existing = this.connectedNodes.find(n => n.node_id === nodeId)
      if (existing) {
        if (type) existing.type = type
      } else {
        this.connectedNodes.push({ node_id: nodeId, type: type || '', long_name: '' })
      }
      await this.setActiveNode(nodeId)
      // refresh long_name after mesh nodes loaded
      const meshNode = this.meshNodes.find(n => n.node_id === nodeId)
      if (meshNode) {
        const entry = this.connectedNodes.find(n => n.node_id === nodeId)
        if (entry) entry.long_name = meshNode.long_name || ''
      }
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
          if (!this.connectedNodes.find(n => n.node_id === payload.node_id)) {
            this.connectedNodes.push({ node_id: payload.node_id, type: '', long_name: '' })
          }
          break
        case 'node.disconnected':
          this.connectedNodes = this.connectedNodes.filter(n => n.node_id !== payload.node_id)
          delete this.unreadByNode[payload.node_id]
          if (this.activeNodeId === payload.node_id) {
            const next = this.connectedNodes[0]?.node_id ?? null
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
            this.$refs.nodeModal?.view && (this.$refs.nodeModal.view = 'traceroute')
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

    updateMeshNode(node) {
      const idx = this.meshNodes.findIndex(n => n.node_id === node.node_id)
      if (idx === -1) {
        this.meshNodes = [...this.meshNodes, node]
      } else {
        const existing = this.meshNodes[idx]
        const merged = {
          ...(node.is_favorite == null && { is_favorite: existing.is_favorite }),
          ...(node.is_ignored == null && { is_ignored: existing.is_ignored }),
          ...node,
        }
        this.meshNodes = this.meshNodes.map((n, i) => i === idx ? merged : n)
        if (this.sidebarInfoNode?.node_id === node.node_id) {
          this.sidebarInfoNode = merged
        }
      }
    },

    async showNodeInfo(node) {
      const full = this.meshNodes.find(n => n.node_id === node.node_id)
      this.sidebarInfoNode = full || node
      this.tracerouteHistory = []
      this.traceroutePending = false
      if (window.pywebview?.api) {
        this.tracerouteHistory = await window.pywebview.api.get_traceroute_history(node.node_id)
      }
    },

    async showTracerouteHistory() {
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
        const updated = { ...node, is_favorite: newVal }
        this.updateMeshNode(updated)
        this.sidebarInfoNode = updated
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

      <NodeInfoModal
        v-if="sidebarInfoNode"
        ref="nodeModal"
        :node="sidebarInfoNode"
        :traceroute-history="tracerouteHistory"
        :traceroute-pending="traceroutePending"
        @close="sidebarInfoNode = null"
        @exchange-user-info="exchangeUserInfo"
        @trace-route="traceRoute"
        @toggle-favorite="toggleFavorite"
        @toggle-ignore="toggleIgnore"
        @confirm-delete="confirmDeleteNode"
        @show-traceroute="showTracerouteHistory"
      />
    </div>
  `,
}

createApp(App).directive('tooltip', tooltipDirective).mount('#app')
