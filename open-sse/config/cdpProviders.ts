export interface CdpProviderDomConfig {
    inputSelector: string;
    submitSelector: string;
    streamSelector: string;
}

export const CDP_PROVIDER_REGISTRY: Record<string, CdpProviderDomConfig> = {
    'tencent-aistudio-web': {
        inputSelector: 'textarea.chat-input',
        submitSelector: 'button.send-btn',
        streamSelector: '.message-stream-body'
    },
    'kimi-web': {
        inputSelector: 'div[contenteditable="true"]',
        submitSelector: 'button[aria-label="Send"]',
        streamSelector: '.message-list .latest-reply'
    },
    'deepseek-web': {
        inputSelector: '#chat-input',
        submitSelector: '.ds-button[aria-label="Send"]',
        streamSelector: '.ds-markdown-content'
    },
    'gemini-web': {
        inputSelector: 'rich-textarea p',
        submitSelector: 'button[aria-label="Send message"]',
        streamSelector: 'message-content.model-response'
    },
    'chatgpt-web': {
        inputSelector: '#prompt-textarea',
        submitSelector: 'button[data-testid="send-button"]',
        streamSelector: 'div[data-message-author-role="assistant"]'
    }
};
