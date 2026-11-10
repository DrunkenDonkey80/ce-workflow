import {useRef, useState} from 'react';
import {Button} from '@astryxdesign/core/Button';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Switch} from '@astryxdesign/core/Switch';
import {AppHeader} from './shared.jsx';

const NAME_ERROR = {type: 'error', message: 'Enter a workspace name. It can’t be blank.'};

export function Settings({isDark, onDarkChange}) {
  const [savedName, setSavedName] = useState('Relay');
  const [name, setName] = useState('Relay');
  const [notifications, setNotifications] = useState(true);
  const [nameError, setNameError] = useState(null);
  const [savedMessage, setSavedMessage] = useState('');
  const nameRef = useRef(null);

  const edited = fn => value => {
    fn(value);
    setSavedMessage('');
  };

  const save = e => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError(NAME_ERROR);
      // After the press finishes: Astryx Button keeps focus on itself through the click.
      requestAnimationFrame(() => nameRef.current?.focus());
      return;
    }
    setName(trimmed);
    setSavedName(trimmed);
    setSavedMessage('Settings saved for this session. They reset when you reload or leave this page.');
  };

  return (
    <div className="page">
      <a className="skip-link" href="#main" data-id="skip-link">Skip to settings</a>
      <AppHeader page="settings" workspace={savedName} />
      <main id="main" className="page-main settings-main" data-id="main">
        <div className="page-title" data-id="page-title">
          <h1 data-id="page-heading">Settings</h1>
          <p data-id="page-summary">
            Workspace preferences for this preview. Nothing is sent to a server, so changes last until you reload or leave the page.
          </p>
        </div>

        <form className="settings-form" onSubmit={save} noValidate data-id="settings-form">
          <section className="settings-group" aria-labelledby="workspace-heading" data-id="workspace-section">
            <h2 id="workspace-heading" data-id="workspace-heading">Workspace</h2>
            <TextInput
              label="Workspace name"
              description="Shown in the header."
              value={name}
              onChange={edited(value => {
                setName(value);
                if (value.trim()) setNameError(null);
              })}
              isRequired
              status={nameError ?? undefined}
              statusVariant="detached"
              ref={nameRef}
              data-id="workspace-name"
            />
          </section>

          <section className="settings-group" aria-labelledby="notifications-heading" data-id="notifications-section">
            <h2 id="notifications-heading" data-id="notifications-heading">Notifications</h2>
            <Switch
              label="Project updates"
              description="Notify me when a project changes owner, status or due date."
              value={notifications}
              onChange={edited(setNotifications)}
              labelPosition="start"
              labelSpacing="spread"
              width="100%"
              data-id="notifications"
            />
          </section>

          <section className="settings-group" aria-labelledby="appearance-heading" data-id="appearance-section">
            <h2 id="appearance-heading" data-id="appearance-heading">Appearance</h2>
            <Switch
              label="Dark appearance"
              description="Previews right away on this page."
              value={isDark}
              onChange={edited(onDarkChange)}
              labelPosition="start"
              labelSpacing="spread"
              width="100%"
              data-id="appearance"
            />
          </section>

          <div className="settings-actions" data-id="settings-actions">
            <Button label="Save settings" variant="primary" type="submit" data-id="save-settings" />
            <p className="saved-ack" role="status" data-id="settings-saved-status">
              {savedMessage && (
                <>
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
                    <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {savedMessage}
                </>
              )}
            </p>
          </div>
        </form>
      </main>
    </div>
  );
}
