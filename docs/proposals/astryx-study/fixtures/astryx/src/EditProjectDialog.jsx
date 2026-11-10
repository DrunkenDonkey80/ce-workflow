import {useRef, useState} from 'react';
import {Dialog, DialogHeader} from '@astryxdesign/core/Dialog';
import {Layout, LayoutContent, LayoutFooter, HStack, VStack} from '@astryxdesign/core/Layout';
import {Button} from '@astryxdesign/core/Button';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Selector} from '@astryxdesign/core/Selector';
import {DateInput} from '@astryxdesign/core/DateInput';
import {OWNERS, STATUSES} from './data.js';

const NAME_ERROR = {type: 'error', message: 'Enter a project name. It can’t be blank.'};

function EditProjectForm({project, onCancel, onSave}) {
  const [draft, setDraft] = useState(project);
  const [nameError, setNameError] = useState(null);
  const nameRef = useRef(null);
  const set = key => value => setDraft(d => ({...d, [key]: value}));

  const submit = e => {
    e.preventDefault();
    const name = draft.name.trim();
    if (!name) {
      setNameError(NAME_ERROR);
      // After the press finishes: Astryx Button keeps focus on itself through the click.
      requestAnimationFrame(() => nameRef.current?.focus());
      return;
    }
    onSave({...draft, name});
  };

  return (
    <form onSubmit={submit} noValidate data-id="edit-project-form">
      <Layout
        header={<DialogHeader title="Edit project" subtitle={project.name} />}
        content={
          <LayoutContent>
            <VStack gap={4}>
              <TextInput
                label="Project name"
                value={draft.name}
                onChange={value => {
                  set('name')(value);
                  if (value.trim()) setNameError(null);
                }}
              isRequired
                status={nameError ?? undefined}
                statusVariant="detached"
                ref={nameRef}
                data-id="project-name"
              />
              <Selector label="Owner" options={OWNERS} value={draft.owner} onChange={set('owner')} data-id="project-owner" />
              <Selector label="Status" options={STATUSES} value={draft.status} onChange={set('status')} data-id="project-status" />
              <DateInput
                label="Due date"
                value={draft.due}
                onChange={value => value && set('due')(value)}
                format="date"
                data-id="project-due"
              />
            </VStack>
          </LayoutContent>
        }
        footer={
          <LayoutFooter>
            <div className="dialog-actions" data-id="edit-project-actions">
            <HStack gap={2} hAlign="end" wrap="wrap">
              <Button label="Cancel" variant="secondary" onClick={onCancel} data-id="cancel-project" />
              <Button label="Save changes" variant="primary" type="submit" data-id="save-project" />
            </HStack>
            </div>
          </LayoutFooter>
        }
      />
    </form>
  );
}

export function EditProjectDialog({editing, onClose, onSave}) {
  return (
    <Dialog
      isOpen={editing != null}
      onOpenChange={isOpen => !isOpen && onClose()}
      purpose="form"
      width={480}
      maxHeight="90dvh"
      data-id="edit-project-dialog"
    >
      {editing && (
        <EditProjectForm key={editing.project.id} project={editing.project} onCancel={onClose} onSave={onSave} />
      )}
    </Dialog>
  );
}
