import readline from 'node:readline';
if (process.argv.includes('mcp')) {
    console.log(JSON.stringify([
        {
            name: 'agent-desktop'
        },
        {
            name: 'private-tools'
        }
    ]));
    process.exit(0);
}
const mode = process.env.FAKE_CODEX_MODE || 'success';
let thread = 'thread-local', turn = 'turn-local';
const send = (v)=>process.stdout.write(JSON.stringify(v) + '\n');
readline.createInterface({
    input: process.stdin
}).on('line', (line)=>{
    const m = JSON.parse(line);
    if (m.method === 'initialize') send({
        id: m.id,
        result: {
            userAgent: 'offline-test'
        }
    });
    else if (m.method === 'thread/start') {
        if (m.params.config?.['features.shell_tool'] === false) {
            if (m.params.sandbox !== 'read-only' || Object.keys(m.params.config.mcp_servers ?? {
                bad: true
            }).length !== 0) throw Error('Pure vision permissions not applied');
        }
        if (m.params.ephemeral !== true) throw Error('Not ephemeral');
        send({
            id: m.id,
            result: {
                thread: {
                    id: thread,
                    ephemeral: true
                }
            }
        });
    } else if (m.method === 'turn/start') {
        send({
            id: m.id,
            result: {
                turn: {
                    id: turn
                }
            }
        });
        if (mode === 'hang') return;
        if (m.params.outputSchema) {
            if (!m.params.input.some((x)=>x.type === 'localImage')) throw Error('Image not attached natively');
            send({
                method: 'item/completed',
                params: {
                    threadId: thread,
                    turnId: turn,
                    item: {
                        type: 'agentMessage',
                        text: JSON.stringify({
                            overview: 'fixture image',
                            text: [
                                {
                                    text: 'hello',
                                    imageIndex: 0,
                                    box: [
                                        1,
                                        2,
                                        3,
                                        4
                                    ]
                                }
                            ],
                            elements: [],
                            uncertainties: []
                        }),
                        phase: 'final_answer'
                    }
                }
            });
            send({
                method: 'turn/completed',
                params: {
                    threadId: thread,
                    turn: {
                        id: turn,
                        status: 'completed'
                    }
                }
            });
            return;
        }
        if (mode === 'error') {
            process.stderr.write('Bearer PRIVATE_TEST_SECRET_DO_NOT_LOG\n');
            send({
                method: 'turn/completed',
                params: {
                    threadId: thread,
                    turn: {
                        id: turn,
                        status: 'failed',
                        error: {
                            message: 'PRIVATE_TEST_SECRET_DO_NOT_LOG'
                        }
                    }
                }
            });
            return;
        }
        if (mode !== 'empty') send({
            method: 'item/completed',
            params: {
                threadId: thread,
                turnId: turn,
                item: {
                    type: 'agentMessage',
                    text: 'OFFLINE_VERIFIED_RESULT',
                    phase: 'final_answer'
                }
            }
        });
        send({
            method: 'turn/completed',
            params: {
                threadId: thread,
                turn: {
                    id: turn,
                    status: 'completed'
                }
            }
        });
    } else if (m.method === 'turn/interrupt') send({
        id: m.id,
        result: {}
    });
});
