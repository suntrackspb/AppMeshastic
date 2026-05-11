import MessageBubble from './MessageBubble.js'
import InputBar from './InputBar.js'

export default {
  name: 'ChatView',
  components: { MessageBubble, InputBar },
  emits: ['channel-change', 'dm-change', 'dm-close'],
  props: {
    contactKey: String,
    activeNodeId: String,
    meshNodes: { type: Array, default: () => [] },
    channels: { type: Array, default: () => [{ index: 0, name: 'Primary', role: 'primary' }] },
    mirrorMsgs: { type: Array, default: () => [] },
    relayInfo: { type: Object, default: () => ({}) },
    unreadChannels: { type: Object, default: () => ({}) },
    ilyaDumovMode: { type: Boolean, default: false },
    dmTabs: { type: Array, default: () => [] },
    unreadDms: { type: Object, default: () => ({}) },
  },
  data() {
    return {
      messages: [],
      replyTo: null,
      loading: false,
      hasMore: true,
      activeChannelIndex: 0,
      nodeInfoNode: null,
      autoScroll: true,
    }
  },
  computed: {
    messagesById() {
      const map = {}
      for (const m of this.allMessages) map[m.packet_id] = m
      return map
    },
    allMessages() {
      const radioById = {}
      for (const m of this.messages) radioById[m.packet_id] = true
      const uniqueMirror = this.mirrorMsgs.filter(m => !radioById[m.packet_id])
      const combined = [...this.messages, ...uniqueMirror]
      combined.sort((a, b) => this.msgTs(a) - this.msgTs(b))
      return combined
    },
    nodeMap() {
      const map = {}
      for (const n of this.meshNodes) {
        map[n.node_id] = n
        // also index by numeric id (without !)
        const numeric = parseInt(n.node_id.replace('!', ''), 16)
        if (!isNaN(numeric)) map[String(numeric)] = n
      }
      return map
    },
  },
  watch: {
    contactKey: {
      immediate: true,
      async handler(val) {
        this.activeChannelIndex = parseInt(val?.split('_')[0] ?? '0')
        this.messages = []
        this.hasMore = true
        await this.loadMessages()
      },
    },
    mirrorMsgs(newVal, oldVal) {
      if (newVal.length > oldVal.length && this.autoScroll) {
        this.$nextTick(this.scrollToBottom)
      }
    },
  },
  methods: {
    formatUptime(seconds) {
      const h = Math.floor(seconds / 3600)
      const m = Math.floor((seconds % 3600) / 60)
      return h > 0 ? `${h}ч ${m}м` : `${m}м`
    },
    formatLastSeen(ts) {
      return new Date(ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    },
    async loadMessages(beforeId = null) {
      if (!this.contactKey || this.loading) return
      this.loading = true
      try {
        const batch = await window.pywebview.api.get_messages(this.contactKey, beforeId, 50)
        if (beforeId) {
          this.messages = [...batch, ...this.messages]
        } else {
          this.messages = batch
          this.$nextTick(() => {
            this.autoScroll = true
            this.scrollToBottom()
          })
        }
        this.hasMore = batch.length === 50
      } finally {
        this.loading = false
      }
    },

    selectChannel(ch) {
      this.activeChannelIndex = ch.index
      this.$emit('channel-change', ch)
    },

    async sendMessage(text) {
      const channel = this.activeChannelIndex
      await window.pywebview.api.send_message(
        text,
        this.contactKey,
        channel,
        this.replyTo?.packet_id ?? null,
      )
      this.replyTo = null
    },

    async sendReaction({ emoji, packet_id }) {
      await window.pywebview.api.send_reaction(emoji, packet_id, this.activeChannelIndex)
    },

    msgTs(msg) {
      return new Date(msg.received_at || msg.sent_at || 0).getTime()
    },

    insertSorted(msg) {
      const ts = this.msgTs(msg)
      // Find first message that's newer than msg
      let pos = this.messages.length
      for (let i = this.messages.length - 1; i >= 0; i--) {
        if (this.msgTs(this.messages[i]) <= ts) break
        pos = i
      }
      this.messages.splice(pos, 0, msg)
      return pos
    },

    onNewMessage(msg) {
      console.log('[chat] onNewMessage contact_key=%s contactKey=%s', msg.contact_key, this.contactKey)
      if (msg.contact_key !== this.contactKey) return
      const idx = this.messages.findIndex(m => m.packet_id === msg.packet_id)
      if (idx === -1) {
        const pos = this.insertSorted(msg)
        // Only scroll if inserted at the very end
        if (pos === this.messages.length - 1 && this.autoScroll) {
          this.$nextTick(this.scrollToBottom)
        }
      } else {
        // Never overwrite a radio/internet message with a mirror copy
        const existing = this.messages[idx]
        if (msg.source === 'mirror' && existing.source !== 'mirror') return
        this.messages[idx] = { ...msg, reactions: existing.reactions }
      }
    },

    onMessageAck(packetId, status) {
      const msg = this.messages.find(m => m.packet_id === packetId)
      if (msg) msg.status = status
    },

    onNewReaction(data) {
      const { reaction } = data
      const msg = this.messages.find(m => m.packet_id === reaction.message_packet_id)
      if (!msg) return
      const exists = msg.reactions.some(
        r => r.from_node_id === reaction.from_node_id && r.emoji === reaction.emoji
      )
      if (!exists) msg.reactions.push(reaction)
    },

    scrollToBottom() {
      const el = this.$refs.list
      if (el) el.scrollTop = el.scrollHeight
    },

    scrollToBottomAndEnable() {
      this.autoScroll = true
      this.scrollToBottom()
    },

    onScroll() {
      const el = this.$refs.list
      if (!el) return

      // Load more when scrolled near the top
      if (el.scrollTop < 100 && this.hasMore && !this.loading) {
        const firstId = this.messages[0]?.id
        this.loadMessages(firstId)
      }

      // Disable autoscroll if not at the bottom (more than 80px away)
      const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      this.autoScroll = distFromBottom < 80
    },
  },
  template: `
    <div class="chat-view">
      <div v-if="channels.length || dmTabs.length" class="channel-tabs">
        <button
          v-for="ch in channels"
          :key="ch.index"
          class="channel-tab"
          :class="{ active: contactKey === ch.index + '_^all', 'has-unread': unreadChannels[ch.index] > 0 }"
          @click="selectChannel(ch)"
        >
          {{ ch.name }}
          <span v-if="unreadChannels[ch.index] > 0" class="channel-tab-badge">{{ unreadChannels[ch.index] }}</span>
        </button>
        <span v-if="channels.length && dmTabs.length" class="channel-tabs-sep"></span>
        <button
          v-for="tab in dmTabs"
          :key="tab.node_id"
          class="channel-tab dm-tab"
          :class="{ active: contactKey === '0_' + tab.node_id, 'has-unread': unreadDms['0_' + tab.node_id] > 0 }"
          @click="$emit('dm-change', '0_' + tab.node_id)"
        >
          🔒 {{ tab.name }}
          <span v-if="unreadDms['0_' + tab.node_id] > 0" class="channel-tab-badge">{{ unreadDms['0_' + tab.node_id] }}</span>
          <span class="dm-tab-close" @click.stop="$emit('dm-close', tab.node_id)">✕</span>
        </button>
      </div>

      <div class="messages-list-wrap">
        <div class="messages-list" ref="list" @scroll="onScroll">
          <div v-if="loading && allMessages.length === 0" class="loading">Загрузка...</div>
          <div v-if="loading && allMessages.length > 0" class="load-more-spinner">↑ Загрузка...</div>

          <MessageBubble
            v-for="msg in allMessages"
            :key="msg.packet_id ?? msg.id"
            :message="msg"
            :reply-source="msg.reply_to_packet_id ? messagesById[msg.reply_to_packet_id] : null"
            :is-mine="msg.from_node_id === activeNodeId"
            :node-map="nodeMap"
            :relay="relayInfo[msg.packet_id] || null"
            @reply="replyTo = $event"
            @react="sendReaction"
            @show-node-info="nodeInfoNode = $event"
          />
        </div>
        <button
          v-if="!autoScroll"
          class="scroll-to-bottom-btn"
          @click="scrollToBottomAndEnable"
          v-tooltip="'Прокрутить вниз'"
        >↓</button>
      </div>

      <InputBar
        :reply-to="replyTo"
        :disabled="!activeNodeId"
        :ilya-dumov-mode="ilyaDumovMode"
        @send="sendMessage"
        @cancel-reply="replyTo = null"
      />

      <!-- Node info modal -->
      <div v-if="nodeInfoNode" class="node-info-overlay" @click.self="nodeInfoNode = null">
        <div class="node-info-modal">
          <button class="node-info-close" @click="nodeInfoNode = null">✕</button>
          <h3>{{ nodeInfoNode.long_name || nodeInfoNode.short_name || nodeInfoNode.node_id }}</h3>
          <table class="node-info-table">
            <tr v-if="nodeInfoNode.node_id"><td>ID</td><td>{{ nodeInfoNode.node_id }}</td></tr>
            <tr v-if="nodeInfoNode.short_name"><td>Short name</td><td>{{ nodeInfoNode.short_name }}</td></tr>
            <tr v-if="nodeInfoNode.long_name"><td>Long name</td><td>{{ nodeInfoNode.long_name }}</td></tr>
            <tr v-if="nodeInfoNode.hw_model"><td>Железо</td><td>{{ nodeInfoNode.hw_model }}</td></tr>
            <tr v-if="nodeInfoNode.role"><td>Роль</td><td>{{ nodeInfoNode.role }}</td></tr>
            <tr v-if="nodeInfoNode.city"><td>Город</td><td>{{ nodeInfoNode.city }}</td></tr>
            <tr v-if="nodeInfoNode.firmware_version"><td>Прошивка</td><td>{{ nodeInfoNode.firmware_version }}</td></tr>
            <tr v-if="nodeInfoNode.latitude != null"><td>Координаты</td><td>{{ nodeInfoNode.latitude }}, {{ nodeInfoNode.longitude }}</td></tr>
            <tr v-if="nodeInfoNode.altitude != null"><td>Высота</td><td>{{ nodeInfoNode.altitude }} м</td></tr>
            <tr v-if="nodeInfoNode.battery_level != null"><td>Батарея</td><td>{{ nodeInfoNode.battery_level }}%</td></tr>
            <tr v-if="nodeInfoNode.voltage != null"><td>Напряжение</td><td>{{ nodeInfoNode.voltage }} В</td></tr>
            <tr v-if="nodeInfoNode.channel_utilization != null"><td>Загр. канала</td><td>{{ nodeInfoNode.channel_utilization }}%</td></tr>
            <tr v-if="nodeInfoNode.air_util_tx != null"><td>Air util TX</td><td>{{ nodeInfoNode.air_util_tx }}%</td></tr>
            <tr v-if="nodeInfoNode.uptime_seconds != null"><td>Аптайм</td><td>{{ formatUptime(nodeInfoNode.uptime_seconds) }}</td></tr>
            <tr v-if="nodeInfoNode.snr != null"><td>Последний SNR</td><td>{{ nodeInfoNode.snr }} dB</td></tr>
            <tr v-if="nodeInfoNode.rssi != null"><td>RSSI</td><td>{{ nodeInfoNode.rssi }} dBm</td></tr>
            <tr v-if="nodeInfoNode.temperature != null"><td>Температура</td><td>{{ nodeInfoNode.temperature }} °C</td></tr>
            <tr v-if="nodeInfoNode.humidity != null"><td>Влажность</td><td>{{ nodeInfoNode.humidity }}%</td></tr>
            <tr v-if="nodeInfoNode.pressure != null"><td>Давление</td><td>{{ nodeInfoNode.pressure }} гПа</td></tr>
            <tr v-if="nodeInfoNode.last_seen_at"><td>Последний раз</td><td>{{ formatLastSeen(nodeInfoNode.last_seen_at) }}</td></tr>
          </table>
        </div>
      </div>
    </div>
  `,
}
