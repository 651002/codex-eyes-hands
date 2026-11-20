import readline from 'node:readline';
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
