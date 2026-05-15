export default {
  name: 'EmojiSettingsDialog',
  emits: ['close'],
  data() {
    return {
      emojis: [],
      newEmoji: '',
    }
  },
  async mounted() {
    this.emojis = await window.pywebview.api.get_quick_emojis()
  },
  methods: {
    async addEmoji() {
      const emoji = this.newEmoji.trim()
      if (!emoji || this.emojis.includes(emoji)) return
      this.emojis.push(emoji)
      this.newEmoji = ''
      await window.pywebview.api.save_quick_emojis(this.emojis)
    },

    async removeEmoji(index) {
      this.emojis.splice(index, 1)
      await window.pywebview.api.save_quick_emojis(this.emojis)
    },

    async resetEmojis() {
      if (!confirm('Сбросить реакции к умолчанию?')) return
      this.emojis = await window.pywebview.api.reset_quick_emojis()
    },
  },
  template: `
    <div class="dialog-overlay" @click.self="$emit('close')">
      <div class="dialog">
        <div class="dialog-header">
          <span>Реакции</span>
          <button class="btn-icon" @click="$emit('close')">✕</button>
        </div>
        <div class="dialog-body">
          <div class="emoji-tags">
            <span v-for="(emoji, i) in emojis" :key="i" class="emoji-tag">
              {{ emoji }}<button class="emoji-tag-remove" @click="removeEmoji(i)">×</button>
            </span>
          </div>
          <div class="emoji-add-row">
            <input
              v-model="newEmoji"
              class="input-field emoji-input"
              placeholder="Смайлик..."
              @keydown.enter="addEmoji"
            />
            <button class="btn-accent" style="width:auto;white-space:nowrap" @click="addEmoji">Добавить</button>
          </div>
          <button class="btn-secondary" style="margin-top:8px" @click="resetEmojis">Сбросить к умолчанию</button>
        </div>
      </div>
    </div>
  `,
}
