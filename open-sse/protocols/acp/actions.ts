import { simulateHumanTyping, simulateHumanReading } from '../../services/cdp/stealth.js';

export interface AcpAction {
    type: 'WRITE' | 'SUBMIT' | 'READ';
    target: string;
    payload?: string;
}

export async function executeAcpAction(page: any, action: AcpAction) {
    if (action.type === 'WRITE' && action.payload) {
        await simulateHumanTyping(page, action.target, action.payload);
    } else if (action.type === 'READ') {
        await simulateHumanReading(page);
    }
}
