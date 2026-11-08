import React, { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { StreamLanguage } from '@codemirror/language';
import { lua } from '@codemirror/legacy-modes/mode/lua';

/** Lua 代码编辑器（CodeMirror 6），与主仓库面板同一套语言模式。 */
export default function CodeEditor({ value = '', onChange, height = 360, readOnly = false }) {
    const hostRef = useRef(null);
    const viewRef = useRef(null);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    useEffect(() => {
        const view = new EditorView({
            state: EditorState.create({
                doc: value,
                extensions: [
                    basicSetup,
                    StreamLanguage.define(lua),
                    EditorView.theme({
                        '&': { height: `${height}px`, fontSize: '13px', border: '1px solid #cbd5e1', borderRadius: '8px' },
                        '.cm-scroller': { overflow: 'auto', fontFamily: 'SFMono-Regular, Consolas, monospace' },
                        '&.cm-focused': { outline: '2px solid #93c5fd', outlineOffset: '-1px' },
                    }),
                    EditorView.editable.of(!readOnly),
                    EditorView.updateListener.of((u) => {
                        if (u.docChanged && onChangeRef.current) onChangeRef.current(u.state.doc.toString());
                    }),
                ],
            }),
            parent: hostRef.current,
        });
        viewRef.current = view;
        return () => { view.destroy(); viewRef.current = null; };
        // 只在挂载时创建；value 变化走下面的同步 effect
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const view = viewRef.current;
        if (!view) return;
        const cur = view.state.doc.toString();
        if (value !== cur) view.dispatch({ changes: { from: 0, to: cur.length, insert: value || '' } });
    }, [value]);

    return <div ref={hostRef} />;
}
