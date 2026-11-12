// Hand-written picture example (V-08): the pinned TextInput has no example.
import {useState} from 'react';
import {TextInput} from '@astryxdesign/core/TextInput';
import {VStack} from '@astryxdesign/core/VStack';
export default function TextInputShowcase() {
  const [name, setName] = useState('Ada Lovelace');
  const [email, setEmail] = useState('');
  return (
    <VStack gap={4}>
      <TextInput label="Full name" value={name} onChange={setName} />
      <TextInput label="Work email" type="email" placeholder="name@example.com" description="We send the invite here." value={email} onChange={setEmail} />
    </VStack>
  );
}
