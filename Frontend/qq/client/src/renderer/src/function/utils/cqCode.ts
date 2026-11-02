// Import the pure codec entry: the package root also registers server protocols.
import { CQCode } from '@onebots/protocol-onebot-v11/lib/cqcode.js'

export interface CqSegment {
    readonly type: string
    readonly _type?: unknown
    readonly [key: string]: unknown
}

/** Adapt OneBot's canonical segments to the client's existing flat message model. */
export function parseCqSegments(message: string): CqSegment[] {
    return CQCode.parse(message).map(({ type, data }) => {
        const { type: parameterType, ...fields } = data
        return { ...fields, type, ...(parameterType === undefined ? {} : { _type: parameterType }) }
    })
}

export function stringifyCqSegments(segments: readonly CqSegment[]): string {
    return CQCode.stringify(segments.map(({ type, _type, ...data }) => ({
        type,
        data: { ...data, ...(_type === undefined ? {} : { type: _type }) },
    })))
}
