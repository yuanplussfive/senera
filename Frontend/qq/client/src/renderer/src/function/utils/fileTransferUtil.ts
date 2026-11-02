export function isActiveTransferStatus(status: string): boolean {
    return status === 'downloading'
}

export function getOneBotResponseError(response: any): string | undefined {
    if (response?.status === 'ok' && Number(response?.retcode ?? 0) === 0) {
        return undefined
    }
    return response?.message || response?.wording || response?.msg ||
        (response?.retcode !== undefined? `retcode ${response.retcode}`: 'OneBot request failed')
}
