export default {
  name: 'SettingsDialog',
  props: {
    activeContactKey: String,
    ilyaDumovMode: Boolean,
  },
  emits: ['close', 'nodes-updated', 'chat-cleared', 'update:ilya-dumov-mode'],
  data() {
    return {
      importUrl: 'https://m.etohost.ru/api/nodes',
      importing: false,
      importResult: null,
      clearingNodes: false,
      clearingChat: false,
    }
  },
  methods: {
    async importNodes() {
      this.importing = true
      this.importResult = null
      try {
        const result = await window.pywebview.api.import_nodes_from_url(this.importUrl)
        if (result.error) {
          this.importResult = { error: result.error }
        } else {
          this.importResult = { ok: `Импортировано ${result.imported} нод` }
          this.$emit('nodes-updated')
        }
      } finally {
        this.importing = false
      }
    },

    async clearNodes() {
      if (!confirm('Очистить кэш нод? Данные о нодах в сети будут удалены.')) return
      this.clearingNodes = true
      try {
        await window.pywebview.api.clear_nodes()
        this.$emit('nodes-updated')
      } finally {
        this.clearingNodes = false
      }
    },

    async clearChat() {
      if (!confirm('Очистить историю чата?')) return
      this.clearingChat = true
      try {
        await window.pywebview.api.clear_chat(this.activeContactKey)
        this.$emit('chat-cleared')
      } finally {
        this.clearingChat = false
      }
    },
  },
  template: `
    <div class="dialog-overlay" @click.self="$emit('close')">
      <div class="dialog">
        <div class="dialog-header">
          <span>Настройки</span>
          <button class="btn-icon" @click="$emit('close')">✕</button>
        </div>
        <div class="dialog-body">

          <div class="settings-section">
            <div class="settings-section-title">Импорт нод</div>
            <label>URL источника</label>
            <input v-model="importUrl" class="input-field" style="margin-bottom:8px" />
            <button
              class="btn-accent"
              :disabled="importing"
              @click="importNodes"
            >{{ importing ? 'Загрузка...' : 'Импортировать ноды' }}</button>
            <div v-if="importResult" class="settings-result" :class="{ error: importResult.error }">
              {{ importResult.error || importResult.ok }}
            </div>
          </div>

          <div class="settings-section">
            <div class="settings-section-title">Интерфейс</div>
            <div class="settings-row">
              <div class="settings-row-info">
                <span class="settings-row-label">For ILYA_DUMOV</span>
                <span class="settings-row-hint">5 байтов вместо 5 байт</span>
              </div>
              <label class="mirror-toggle">
                <input type="checkbox" :checked="ilyaDumovMode" @change="$emit('update:ilya-dumov-mode', $event.target.checked)" />
                <span class="mirror-toggle-track"><span class="mirror-toggle-thumb"></span></span>
              </label>
            </div>
          </div>

          <div class="settings-section">
            <div class="settings-section-title">Очистка</div>
            <button
              class="btn-danger"
              :disabled="clearingNodes"
              @click="clearNodes"
            >{{ clearingNodes ? 'Очистка...' : 'Очистить кэш нод' }}</button>
            <button
              class="btn-danger"
              :disabled="clearingChat || !activeContactKey"
              @click="clearChat"
              style="margin-top:8px"
            >{{ clearingChat ? 'Очистка...' : 'Очистить историю чата' }}</button>
          </div>

        </div>
      </div>
    </div>
  `,
}
