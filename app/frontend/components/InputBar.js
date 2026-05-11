import { applyGlyphZip } from '../utils/glyphzip.js'

const MESH_MAX_BYTES = 200

export default {
  name: 'InputBar',
  props: {
    replyTo: Object,
    disabled: Boolean,
    ilyaDumovMode: { type: Boolean, default: false },
  },
  emits: ['send', 'cancel-reply'],
  data() {
    return { text: '', glyphLevel: 0 }
  },
  computed: {
    glyphGroups() {
      return [[], ['g1'], ['g1', 'g2'], ['g1', 'g2', 'g3']][this.glyphLevel]
    },
    glyphLabel() {
      return ['ZIP', 'ZIP·1', 'ZIP·2', 'ZIP·3'][this.glyphLevel]
    },
    compressedText() {
      return this.glyphLevel > 0 ? applyGlyphZip(this.text, this.glyphGroups) : this.text
    },
    byteLength() {
      return new TextEncoder().encode(this.compressedText).length
    },
    savedBytes() {
      if (this.glyphLevel === 0) return 0
      return new TextEncoder().encode(this.text).length - this.byteLength
    },
    bytesLeft() {
      return MESH_MAX_BYTES - this.byteLength
    },
    overLimit() {
      return this.byteLength > MESH_MAX_BYTES
    },
    counterState() {
      const ratio = this.byteLength / MESH_MAX_BYTES
      if (ratio >= 1) return 'over'
      if (ratio >= 0.85) return 'warn'
      if (ratio >= 0.65) return 'caution'
      return 'ok'
    },
    fillPercent() {
      return Math.min(this.byteLength / MESH_MAX_BYTES * 100, 100)
    },
    showCounter() {
      return this.byteLength > 0 || new TextEncoder().encode(this.text).length > 0
    },
  },
  template: `
    <div class="input-bar">
      <div v-if="replyTo" class="reply-indicator">
        <span>↩ Ответ для <b>{{ replyTo.from_node_id }}</b>: {{ replyTo.text }}</span>
        <button class="btn-icon" @click="$emit('cancel-reply')">✕</button>
      </div>
      <div class="input-row">
        <textarea
          v-model="text"
          class="message-input"
          :class="{ 'input-over-limit': overLimit }"
          placeholder="Сообщение..."
          :disabled="disabled"
          rows="1"
          @keydown.enter.exact.prevent="send"
        ></textarea>
        <button
          class="btn-zip"
          :class="{ active: glyphLevel > 0 }"
          :title="['GlyphZip выключен','Уровень 1: безопасные замены','Уровень 2: + похожие символы','Уровень 3: максимальное сжатие'][glyphLevel]"
          @click="glyphLevel = (glyphLevel + 1) % 4"
        >{{ glyphLabel }}</button>
        <button class="btn-send" :disabled="disabled || !text.trim() || overLimit" @click="send">
          ➤
        </button>
      </div>
      <div v-if="showCounter" class="byte-counter" :class="'byte-counter--' + counterState">
        <span v-if="overLimit">Превышено на {{ pluralBytes(-bytesLeft) }}</span>
        <span v-else>{{ pluralBytes(bytesLeft) }} осталось</span>
        <span v-if="savedBytes > 0" class="byte-counter-saved">−{{ pluralBytes(savedBytes) }}</span>
        <span class="byte-counter-bar-wrap">
          <span class="byte-counter-bar" :style="{ width: fillPercent + '%' }"></span>
        </span>
      </div>
    </div>
  `,
  methods: {
    pluralBytes(n) {
      const abs = Math.abs(n)
      const mod10 = abs % 10
      const mod100 = abs % 100
      if (mod100 >= 11 && mod100 <= 19) return `${n} ${this.ilyaDumovMode ? 'байтов' : 'байт'}`
      if (mod10 === 1) return `${n} байт`
      if (mod10 >= 2 && mod10 <= 4) return `${n} байта`
      return `${n} ${this.ilyaDumovMode ? 'байтов' : 'байт'}`
    },
    send() {
      const trimmed = this.compressedText.trim()
      if (!trimmed || this.overLimit) return
      this.$emit('send', trimmed)
      this.text = ''
    },
  },
}
