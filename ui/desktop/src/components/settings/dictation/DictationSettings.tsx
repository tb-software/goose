/* global SpeechSynthesisVoice */
import { useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { getDictationConfig, DictationProviderStatusEntry } from '../../../acp/dictation';
import { useConfig } from '../../ConfigContext';
import { Input } from '../../ui/input';
import { Button } from '../../ui/button';
import { trackSettingToggled } from '../../../utils/analytics';
import { LocalModelManager } from './LocalModelManager';
import { MicrophoneSelector } from './MicrophoneSelector';
import { DICTATION_ALLOWED_PROVIDERS } from '../../../updates';
import { useFeatures } from '../../../contexts/FeaturesContext';
import type { DictationProvider } from '../../../types/dictation';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { defineMessages, useIntl } from '../../../i18n';
import { tbSpeech } from '../../../tb/voice/speechOutput';

const i18n = defineMessages({
  voiceDictationProvider: {
    id: 'dictationSettings.voiceDictationProvider',
    defaultMessage: 'Voice Dictation Provider',
  },
  chooseVoiceConversion: {
    id: 'dictationSettings.chooseVoiceConversion',
    defaultMessage: 'Choose how voice is converted to text',
  },
  disabled: {
    id: 'dictationSettings.disabled',
    defaultMessage: 'Disabled',
  },
  notConfigured: {
    id: 'dictationSettings.notConfigured',
    defaultMessage: '(not configured)',
  },
  configureApiKey: {
    id: 'dictationSettings.configureApiKey',
    defaultMessage: 'Configure the API key in <b>{settingsPath}</b>',
  },
  configuredIn: {
    id: 'dictationSettings.configuredIn',
    defaultMessage: '✓ Configured in {settingsPath}',
  },
  apiKey: {
    id: 'dictationSettings.apiKey',
    defaultMessage: 'API Key',
  },
  requiredForTranscription: {
    id: 'dictationSettings.requiredForTranscription',
    defaultMessage: 'Required for transcription',
  },
  configured: {
    id: 'dictationSettings.configured',
    defaultMessage: '(Configured)',
  },
  updateApiKey: {
    id: 'dictationSettings.updateApiKey',
    defaultMessage: 'Update API Key',
  },
  addApiKey: {
    id: 'dictationSettings.addApiKey',
    defaultMessage: 'Add API Key',
  },
  removeApiKey: {
    id: 'dictationSettings.removeApiKey',
    defaultMessage: 'Remove API Key',
  },
  enterApiKey: {
    id: 'dictationSettings.enterApiKey',
    defaultMessage: 'Enter your API key',
  },
  save: {
    id: 'dictationSettings.save',
    defaultMessage: 'Save',
  },
  cancel: {
    id: 'dictationSettings.cancel',
    defaultMessage: 'Cancel',
  },
});

export const DictationSettings = () => {
  const intl = useIntl();
  const { localInference, isLoading: isFeaturesLoading } = useFeatures();
  const [provider, setProvider] = useState<DictationProvider | null>(null);
  const [providerStatuses, setProviderStatuses] = useState<Record<string, DictationProviderStatusEntry>>(
    {}
  );
  const [preferredMic, setPreferredMic] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [isEditingKey, setIsEditingKey] = useState(false);
  // TB-Software: Automatisches Beenden nach X Sekunden Stille (0 = nur per Mikrofon-Knopf).
  const [autostopSeconds, setAutostopSeconds] = useState(0);
  // TB-Software: Nach dem Diktat (per Stille-Autostop) automatisch senden - abbrechbarer Countdown
  // in X Sekunden (0 = aus).
  const [autosendSeconds, setAutosendSeconds] = useState(0);
  // TB-Software: Sprachausgabe (TTS) - Gespraechsmodus, Stimme, Tempo.
  const [conversationMode, setConversationMode] = useState(false);
  const [voiceURI, setVoiceURI] = useState('');
  const [speechRate, setSpeechRate] = useState(1.15);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const { read, upsert, remove } = useConfig();

  useEffect(() => {
    const refresh = () => setVoices(tbSpeech.listVoices());
    refresh();
    const unsub = tbSpeech.subscribe(refresh);
    return unsub;
  }, []);

  const refreshStatuses = async () => {
    const audioConfig = await getDictationConfig();
    setProviderStatuses(audioConfig);
  };

  useEffect(() => {
    if (isFeaturesLoading) return;

    const loadSettings = async () => {
      const providerValue = await read('voice_dictation_provider', false);
      let loadedProvider: DictationProvider | null = (providerValue as DictationProvider) || null;

      if (
        DICTATION_ALLOWED_PROVIDERS &&
        loadedProvider &&
        !DICTATION_ALLOWED_PROVIDERS.includes(loadedProvider)
      ) {
        loadedProvider = null;
        await upsert('voice_dictation_provider', '', false);
      }

      if (!localInference && loadedProvider === 'local') {
        loadedProvider = null;
        await upsert('voice_dictation_provider', '', false);
      }

      setProvider(loadedProvider);

      const micValue = await read('voice_dictation_preferred_mic', false);
      setPreferredMic((micValue as string) || null);

      const autostopValue = await read('voice_dictation_autostop_seconds', false);
      setAutostopSeconds(Number(autostopValue) || 0);

      const autosendValue = await read('voice_dictation_autosend_seconds', false);
      setAutosendSeconds(Number(autosendValue) || 0);

      const convValue = await read('voice_output_conversation', false);
      const conv = String(convValue) === '1' || convValue === true;
      setConversationMode(conv);

      const voiceValue = await read('voice_output_voice', false);
      const voiceStr = (voiceValue as string) || '';
      setVoiceURI(voiceStr);

      const rateValue = await read('voice_output_rate', false);
      const rate = Number(rateValue) || 1.15;
      setSpeechRate(rate);

      tbSpeech.configure({ conversation: conv, voiceURI: voiceStr, rate });

      await refreshStatuses();
    };

    loadSettings();
  }, [read, upsert, localInference, isFeaturesLoading]);

  const handleProviderChange = (value: string) => {
    const newProvider = value === 'disabled' ? null : (value as DictationProvider);
    setProvider(newProvider);
    upsert('voice_dictation_provider', newProvider || '', false);
    trackSettingToggled('voice_dictation', newProvider !== null);
  };

  const handleMicChange = (deviceId: string | null) => {
    setPreferredMic(deviceId);
    upsert('voice_dictation_preferred_mic', deviceId || '', false);
  };

  const handleAutostopChange = (seconds: number) => {
    setAutostopSeconds(seconds);
    upsert('voice_dictation_autostop_seconds', String(seconds), false);
  };

  const handleAutosendChange = (seconds: number) => {
    setAutosendSeconds(seconds);
    upsert('voice_dictation_autosend_seconds', String(seconds), false);
  };

  const handleConversationChange = (enabled: boolean) => {
    setConversationMode(enabled);
    tbSpeech.configure({ conversation: enabled });
    upsert('voice_output_conversation', enabled ? '1' : '0', false);
  };

  const handleVoiceChange = (uri: string) => {
    setVoiceURI(uri);
    tbSpeech.configure({ voiceURI: uri });
    upsert('voice_output_voice', uri, false);
  };

  const handleRateChange = (rate: number) => {
    setSpeechRate(rate);
    tbSpeech.configure({ rate });
    upsert('voice_output_rate', String(rate), false);
  };

  const handleTestVoice = () => {
    tbSpeech.toggle('__settings_test__', 'Hallo, so klingt die gewählte Stimme von TB-Goose.');
  };

  const handleSaveKey = async () => {
    if (!provider) return;
    const providerConfig = providerStatuses[provider];
    if (!providerConfig || providerConfig.usesProviderConfig) return;

    const trimmedKey = apiKey.trim();
    if (!trimmedKey) return;

    const keyName = providerConfig.configKey!;
    await upsert(keyName, trimmedKey, true);
    setApiKey('');
    setIsEditingKey(false);
    await refreshStatuses();
  };

  const handleRemoveKey = async () => {
    if (!provider) return;
    const providerConfig = providerStatuses[provider];
    if (!providerConfig || providerConfig.usesProviderConfig) return;

    const keyName = providerConfig.configKey!;
    await remove(keyName, true);
    setApiKey('');
    setIsEditingKey(false);
    await refreshStatuses();
  };

  const handleCancelEdit = () => {
    setApiKey('');
    setIsEditingKey(false);
  };

  const getProviderLabel = (p: DictationProvider | null): string => {
    if (!p) return intl.formatMessage(i18n.disabled);
    if (p === "model") return "Model (Native Audio)";
    return p.charAt(0).toUpperCase() + p.slice(1);
  };

  const visibleProviders = (Object.keys(providerStatuses) as DictationProvider[]).filter(
    (p) => !DICTATION_ALLOWED_PROVIDERS || DICTATION_ALLOWED_PROVIDERS.includes(p)
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between py-2 px-2 hover:bg-background-secondary rounded-lg transition-all">
        <div>
          <h3 className="text-text-primary">{intl.formatMessage(i18n.voiceDictationProvider)}</h3>
          <p className="text-xs text-text-secondary max-w-md mt-[2px]">
            {intl.formatMessage(i18n.chooseVoiceConversion)}
          </p>
        </div>
        <DropdownMenu onOpenChange={(open) => open && refreshStatuses()}>
          <DropdownMenuTrigger className="flex items-center gap-2 px-3 py-1.5 text-sm border border-border-primary rounded-md hover:border-border-primary transition-colors text-text-primary bg-background-primary">
            {getProviderLabel(provider)}
            <ChevronDown className="w-4 h-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-max min-w-[250px] max-w-[350px]">
            <DropdownMenuRadioGroup
              value={provider ?? 'disabled'}
              onValueChange={handleProviderChange}
            >
              <DropdownMenuRadioItem value="disabled">{intl.formatMessage(i18n.disabled)}</DropdownMenuRadioItem>
              {visibleProviders.map((p) => (
                <DropdownMenuRadioItem key={p} value={p}>
                  {getProviderLabel(p)}
                  {!providerStatuses[p]?.configured && (
                    <span className="text-xs ml-1 text-text-secondary">{intl.formatMessage(i18n.notConfigured)}</span>
                  )}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {provider && providerStatuses[provider] && (
        <>
          {provider === 'local' ? (
            <div className="py-2 px-2">
              <LocalModelManager />
            </div>
          ) : providerStatuses[provider].usesProviderConfig ? (
            <div className="py-2 px-2 bg-background-secondary rounded-lg">
              {!providerStatuses[provider].configured ? (
                <p className="text-xs text-text-secondary">
                  {intl.formatMessage(i18n.configureApiKey, { settingsPath: providerStatuses[provider].settingsPath, b: (chunks: React.ReactNode) => <b>{chunks}</b> })}
                </p>
              ) : (
                <p className="text-xs text-green-600">
                  {intl.formatMessage(i18n.configuredIn, { settingsPath: providerStatuses[provider].settingsPath })}
                </p>
              )}
            </div>
          ) : (
            <div className="py-2 px-2 bg-background-secondary rounded-lg">
              <div className="mb-2">
                <h4 className="text-text-primary text-sm">{intl.formatMessage(i18n.apiKey)}</h4>
                <p className="text-xs text-text-secondary mt-[2px]">
                  {intl.formatMessage(i18n.requiredForTranscription)}
                  {providerStatuses[provider]?.configured && (
                    <span className="text-green-600 ml-2">{intl.formatMessage(i18n.configured)}</span>
                  )}
                </p>
              </div>

              {!isEditingKey ? (
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" size="sm" onClick={() => setIsEditingKey(true)}>
                    {providerStatuses[provider]?.configured ? intl.formatMessage(i18n.updateApiKey) : intl.formatMessage(i18n.addApiKey)}
                  </Button>
                  {providerStatuses[provider]?.configured && (
                    <Button variant="destructive" size="sm" onClick={handleRemoveKey}>
                      {intl.formatMessage(i18n.removeApiKey)}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <Input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={intl.formatMessage(i18n.enterApiKey)}
                    className="max-w-md"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleSaveKey}>
                      {intl.formatMessage(i18n.save)}
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleCancelEdit}>
                      {intl.formatMessage(i18n.cancel)}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

        </>
      )}

      {/* TB-Software: Mikrofon + Autostop gelten auch fuer den gebuendelten OpenAI-Whisper - das Diktat
          funktioniert out-of-box, auch wenn oben kein eigener Provider gewaehlt ist. */}
      <p className="text-xs text-text-secondary px-2">
        Diktat ist einsatzbereit (OpenAI Whisper, Deutsch) - ein eigener Provider oben ist optional.
      </p>
      <MicrophoneSelector selectedDeviceId={preferredMic} onDeviceChange={handleMicChange} />
      <div className="space-y-1 px-2">
        <label className="text-sm font-medium text-text-primary">Automatisch beenden</label>
        <p className="text-xs text-text-secondary">
          Diktat nach einer Sprechpause selbst beenden, oder nur per Mikrofon-Knopf.
        </p>
        <select
          className="max-w-md w-full rounded-md border border-border-primary bg-background-primary px-2 py-1.5 text-sm text-text-primary"
          value={autostopSeconds}
          onChange={(e) => handleAutostopChange(Number(e.target.value))}
        >
          <option value={0}>Nur per Mikrofon-Knopf</option>
          <option value={2}>Nach 2 s Stille beenden</option>
          <option value={3}>Nach 3 s Stille beenden</option>
          <option value={5}>Nach 5 s Stille beenden</option>
        </select>
      </div>

      <div className="space-y-1 px-2">
        <label className="text-sm font-medium text-text-primary">Nach Diktat automatisch senden</label>
        <p className="text-xs text-text-secondary">
          Wenn das Diktat per Stille automatisch endet: der Text landet im Feld und wird nach einem
          kurzen, abbrechbaren Countdown automatisch gesendet. (Tippen oder „Abbrechen" stoppt den
          Countdown.)
        </p>
        <select
          className="max-w-md w-full rounded-md border border-border-primary bg-background-primary px-2 py-1.5 text-sm text-text-primary"
          value={autosendSeconds}
          onChange={(e) => handleAutosendChange(Number(e.target.value))}
        >
          <option value={0}>Aus (nur ins Feld legen)</option>
          <option value={3}>Nach 3 s automatisch senden</option>
          <option value={5}>Nach 5 s automatisch senden</option>
        </select>
      </div>

      {/* TB-Software: Sprachausgabe (Vorlesen + Gespraechsmodus) ueber lokale OS-Stimmen. */}
      <div className="pt-2 mt-2 border-t border-border-primary">
        <h3 className="text-text-primary px-2">Sprachausgabe (Vorlesen)</h3>
        <p className="text-xs text-text-secondary px-2 mt-[2px]">
          Antworten werden mit der lokalen Stimme deines Systems vorgelesen - offline, ohne
          Netzverbindung. Jede Antwort hat dafür einen „Vorlesen"-Knopf.
        </p>
      </div>

      <div className="flex items-center justify-between py-2 px-2 hover:bg-background-secondary rounded-lg transition-all">
        <div>
          <label className="text-sm font-medium text-text-primary">Gesprächsmodus</label>
          <p className="text-xs text-text-secondary max-w-md mt-[2px]">
            Fertige Antworten automatisch vorlesen und danach sofort wieder zuhören - freihändiges
            Gespräch zusammen mit dem Diktat.
          </p>
        </div>
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={conversationMode}
          onChange={(e) => handleConversationChange(e.target.checked)}
        />
      </div>

      <div className="space-y-1 px-2">
        <label className="text-sm font-medium text-text-primary">Stimme</label>
        <div className="flex gap-2 items-center max-w-md">
          <select
            className="w-full rounded-md border border-border-primary bg-background-primary px-2 py-1.5 text-sm text-text-primary"
            value={voiceURI}
            onChange={(e) => handleVoiceChange(e.target.value)}
          >
            <option value="">Automatisch (weibliche deutsche Stimme)</option>
            {voices.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={handleTestVoice}>
            Testen
          </Button>
        </div>
        {voices.length === 0 && (
          <p className="text-xs text-text-secondary">
            Keine Stimmen gefunden - Windows stellt die deutschen Stimmen unter „Sprache" bereit.
          </p>
        )}
      </div>

      <div className="space-y-1 px-2 pb-2">
        <label className="text-sm font-medium text-text-primary">
          Sprechtempo ({speechRate.toFixed(2)}×)
        </label>
        <input
          type="range"
          min={0.8}
          max={1.6}
          step={0.05}
          value={speechRate}
          onChange={(e) => handleRateChange(Number(e.target.value))}
          className="max-w-md w-full"
        />
      </div>
    </div>
  );
};
