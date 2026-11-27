// The medics-refresh theme. `astryx experimental theme editor` wrote this file once and never changes it again.
// The checked settings live in medics-refresh.settings.json and the generated medics-refresh.settings.ts;
// change them with `astryx experimental theme editor set medics-refresh ...`. Add your own changes below: they win over the settings.
import {defineTheme} from '@astryxdesign/core/theme';
import {medicsRefreshSettings} from './medics-refresh.settings';

export const medicsRefreshTheme = defineTheme({
  extends: medicsRefreshSettings,
  name: 'medics-refresh',
});
