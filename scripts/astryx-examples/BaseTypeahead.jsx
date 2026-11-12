// Hand-written picture example: the pinned BaseTypeahead examples need the StyleX compiler.
import {useRef, useState} from 'react';
import {BaseTypeahead, createStaticSource} from '@astryxdesign/core/Typeahead';
const source = createStaticSource([
  {id: 'react', label: 'React'}, {id: 'remix', label: 'Remix'}, {id: 'next', label: 'Next.js'}, {id: 'astro', label: 'Astro'},
]);
export default function BaseTypeaheadPicture() {
  const [value, setValue] = useState(null);
  const wrapper = useRef(null);
  return (
    <div ref={wrapper} style={{width: 320, border: '1px solid var(--color-border)', borderRadius: 8, padding: '6px 8px'}}>
      <BaseTypeahead aria-label="Search frameworks" searchSource={source} value={value} onChange={setValue} anchorRef={wrapper} placeholder="Search frameworks…" hasEntriesOnFocus debounceMs={0} />
    </div>
  );
}
