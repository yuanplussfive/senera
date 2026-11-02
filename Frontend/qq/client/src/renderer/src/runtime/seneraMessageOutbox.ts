import { v4 as uuid } from 'uuid'
import { DurableMessageOutbox } from '../../../../../../src/api/durableMessageOutbox'
import type { MsgItemElem } from '../function/elements/information'

export { DefinitiveMessageRejection } from '../../../../../../src/api/durableMessageOutbox'
export { AgentOneBot11ClientMessageIdParam } from '../../../../../../../Source/AgentSystem/Channels/Client/AgentOneBot11ReliabilityContract'

export interface SeneraOutgoingMessage {
    target: { id: string; type: string }
    message: MsgItemElem[]
    text: string
    partIds: string[]
    attachmentIds: string[]
}

export const seneraMessageOutbox = new DurableMessageOutbox<SeneraOutgoingMessage, Record<string, unknown>>(uuid)
