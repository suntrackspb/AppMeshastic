import { formatTime } from '../utils/format.js'

export default {
  name: 'MessageBubble',
  props: {
    message: Object,
    replySource: Object,
    isMine: Boolean,
    nodeMap: { type: Object, default: () => ({}) },
    relay: { type: Object, default: null },
  },
  emits: ['reply', 'react', 'show-node-info', 'scroll-to-message'],
  data() {
    return {
      showActions: false,
      showEmojiPicker: false,
      pickerStyle: {},
      quickEmojis: ['1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','👍','👎','❤️','🔥','😂','😮','😢','😡','🙏','✅','👀','🤔','💯','🎉','😎','🤣','😍','🥳','😴','💪'],
    }
  },
  computed: {
    senderNode() {
      return this.nodeMap[this.message.from_node_id] || null
    },
    senderName() {
      if (this.isMine) return 'Я'
      const n = this.senderNode
      if (n) return n.long_name || n.short_name || this.shortId(this.message.from_node_id)
      return this.shortId(this.message.from_node_id)
    },
    replyAuthorName() {
      if (!this.replySource || this.replySource._unknown) return '?'
      const n = this.nodeMap[this.replySource.from_node_id]
      if (n) return n.long_name || n.short_name || this.shortId(this.replySource.from_node_id)
      return this.shortId(this.replySource.from_node_id)
    },
    senderColorData() {
      const id = this.message.from_node_id || ''
      const hex = id.startsWith('!') ? id.slice(1) : id
      const nodeNum = parseInt(hex, 16)
      if (!isNaN(nodeNum)) {
        const r = (nodeNum & 0xff0000) >> 16
        const g = (nodeNum & 0x00ff00) >> 8
        const b = nodeNum & 0x0000ff
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
        return { color: `rgb(${r}, ${g}, ${b})`, luminance }
      }
      let hash = 0
      for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash)
      return { color: `hsl(${Math.abs(hash) % 360}, 60%, 45%)`, luminance: 0.3 }
    },
    senderColor() { return this.senderColorData.color },
    tabTextStroke() {
      const c = '#3a3a3a'
      return this.senderColorData.luminance > 0.5
        ? `1px 0 ${c}, -1px 0 ${c}, 0 1px ${c}, 0 -1px ${c}`
        : 'none'
    },
    senderLabel() {
      const n = this.senderNode
      if (n && n.short_name) return n.short_name
      return this.shortId(this.message.from_node_id)
    },
    reactionItems() {
      return (this.message.reactions || []).map(r => {
        const n = this.nodeMap[r.from_node_id]
        return {
          emoji: r.emoji,
          from_node_id: r.from_node_id,
          label: (n && (n.short_name || n.long_name)) ? (n.short_name || this.shortId(r.from_node_id)) : this.shortId(r.from_node_id),
          tooltip: (n && n.long_name) ? n.long_name : r.from_node_id,
        }
      })
    },
    formattedText() {
      if (!this.message.text) return ''
      const escaped = this.message.text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
      return escaped.replace(
        /\b(https?:\/\/[^\s<>"']+|(?:[a-zA-Z0-9](?:[a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+(?:ru|com|net|org|io|me|info|biz|co|uk|de|fr|by|kz|ua|su|рф|xyz|app|dev|site|online|store|shop|tech|pro|cc|tv|рус)(?:\/[^\s<>"']*)?)\b/g,
        (match) => {
          const href = /^https?:\/\//i.test(match) ? match : `https://${match}`
          return `<a href="${href}" target="_blank" rel="noopener noreferrer">${match}</a>`
        }
      )
    },
    statusIcon() {
      const icons = { queued: '🕐', enroute: '📡', delivered: '✓', received: '', error: '✗' }
      return icons[this.message.status] ?? ''
    },
    metaInfo() {
      const parts = []
      if (this.message.hops_away != null) parts.push(`${this.message.hops_away} хоп`)
      if (this.message.snr != null) parts.push(`SNR ${this.message.snr} dB`)
      if (this.message.rssi != null) parts.push(`RSSI ${this.message.rssi} dBm`)
      return parts.join(' · ')
    },
  },
  mounted() {
    this._closeOnOutside = (e) => {
      if (this.showEmojiPicker && !document.querySelector('.emoji-picker')?.contains(e.target)) {
        this.showEmojiPicker = false
      }
    }
    document.addEventListener('pointerdown', this._closeOnOutside, true)
  },
  beforeUnmount() {
    document.removeEventListener('pointerdown', this._closeOnOutside, true)
  },
  methods: {
    openRelayMap(mirrorMsgId) {
      if (mirrorMsgId && window.pywebview) {
        window.pywebview.api.open_relay_map(String(mirrorMsgId))
      }
    },
    shortId(nodeId) {
      if (!nodeId) return '???'
      return (nodeId || '').replace('!', '').slice(-4)
    },
    formatTime,
    toggleEmojiPicker(event) {
      if (this.showEmojiPicker) {
        this.showEmojiPicker = false
        return
      }
      const btn = event.currentTarget
      const rect = btn.getBoundingClientRect()
      const pickerW = 244
      let left = rect.right - pickerW
      if (left < 8) left = 8
      const top = rect.top - 8  // will use transform to go upward
      this.pickerStyle = { left: left + 'px', top: top + 'px' }
      this.showEmojiPicker = true
    },
    pickEmoji(emoji) {
      this.$emit('react', { emoji, packet_id: this.message.packet_id })
      this.showEmojiPicker = false
    },
  },
  template: `
    <div class="bubble-wrapper" :class="{ mine: isMine, mirror: message.source === 'mirror' }">

      <div class="bubble">

        <!-- Colored sender tab (for others' messages) -->
        <div v-if="!isMine" class="bubble-tab" :style="{ background: senderColor }">
          <span class="bubble-tab-label" :style="{ textShadow: tabTextStroke }">{{ senderLabel }}</span>
        </div>

        <div class="bubble-body">

        <!-- Sender name + time header -->
        <div class="bubble-header">
          <span
            v-if="message.source === 'mirror'"
            class="source-badge mirror-badge"
            v-tooltip="'Из зеркала эфира — не получено по радио'"
          >🌐</span>
          <span class="bubble-author" style="cursor:pointer" @click="$emit('show-node-info', senderNode || { node_id: message.from_node_id })">{{ senderName }}<span class="bubble-author-id"> {{ message.from_node_id }}</span></span>
          <span v-if="isMine && statusIcon" class="bubble-status-inline">{{ statusIcon }}</span>
          <span class="bubble-time">{{ formatTime(message.received_at || message.sent_at) }}</span>
        </div>

        <!-- Reply quote -->
        <div v-if="replySource" class="reply-preview" style="cursor:pointer" @click="$emit('scroll-to-message', replySource.packet_id)">
          <span class="reply-author">↩ {{ replyAuthorName }}</span>
          <span class="reply-text">{{ replySource._unknown ? '...' : replySource.text }}</span>
        </div>

        <!-- Message text -->
        <div class="bubble-text" v-html="formattedText"></div>

        <!-- Signal metadata + relay count + actions -->
        <div class="bubble-signal">
          <span>{{ metaInfo }}</span>
          <span class="bubble-inline-actions">
            <a
              v-if="relay && relay.count > 0"
              class="relay-count"
              href="#"
              @click.prevent="openRelayMap(relay.mirror_msg_id)"
              v-tooltip="'Услышано ' + relay.count + ' MQTT-шлюзами · нажми для карты'"
            >{{ relay.count }}📡</a>
            <button @click="$emit('reply', message)" v-tooltip="'Ответить'">↩</button>
            <button @click="toggleEmojiPicker" v-tooltip="'Реакция'">😊</button>
          </span>
        </div>

        <!-- Reactions -->
        <div v-if="reactionItems.length" class="reactions">
          <span
            v-for="(r, i) in reactionItems"
            :key="i"
            class="reaction"
            v-tooltip="r.tooltip"
            @click="$emit('react', { emoji: r.emoji, packet_id: message.packet_id })"
          >
            <span class="reaction-emoji">{{ r.emoji }}</span>
            <span class="reaction-node">{{ r.label }}</span>
          </span>
        </div>

        </div><!-- /bubble-body -->

        <!-- Colored tab for own messages (right side) -->
        <div v-if="isMine" class="bubble-tab" :style="{ background: senderColor }">
          <span class="bubble-tab-label" :style="{ textShadow: tabTextStroke }">{{ senderLabel }}</span>
        </div>
      </div>

      <teleport to="body">
        <div v-if="showEmojiPicker" class="emoji-picker" :style="pickerStyle">
          <span v-for="emoji in quickEmojis" :key="emoji" @click="pickEmoji(emoji)">{{ emoji }}</span>
        </div>
      </teleport>
    </div>
  `,
}
