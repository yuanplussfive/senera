import { PendingRequests } from '../../../../../../../src/api/pendingRequests'

export class OneBotPendingRequests<T> extends PendingRequests<T> {
    constructor() { super(id => new Error(`OneBot 请求超时 (${id})`)) }
}
