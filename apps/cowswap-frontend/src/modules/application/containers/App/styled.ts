import { CowSwapTheme, Media } from '@cowprotocol/ui'

import * as CSS from 'csstype'
import styled from 'styled-components/macro'

import type { PageBackgroundVariant } from '../../contexts/PageBackgroundContext'

export function isChristmasTheme(theme?: CowSwapTheme): boolean {
  if (!theme) {
    return false
  }

  return ['darkChristmas', 'lightChristmas'].includes(theme)
}

export const AppWrapper = styled.div<Partial<CSS.Properties>>`
  display: flex;
  flex-flow: column;
  align-items: flex-start;
  min-height: ${({ theme }) => (theme.isWidget ? 'auto' : '100vh')};
  height: ${({ theme }) => (theme.isWidget ? 'initial' : '100%')};
  position: relative;
`

export const Marginer = styled.div`
  margin-top: ${({ theme }) => (theme.isWidget ? '0' : '5rem')};
`

export const SceneContainer = styled.div`
  position: absolute;
  bottom: calc(100% - 50px);
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  align-items: flex-end;
  pointer-events: none;
  z-index: 3;
  overflow: hidden;
  transform: translateY(16px);
`

export const FooterSlot = styled.div`
  position: relative;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0;
`

export const BodyWrapper = styled.div<{
  customTheme?: CowSwapTheme
  backgroundVariant?: PageBackgroundVariant
  $hasActiveSpeechBubbleNotification?: boolean
}>`
  --marginBottomOffset: 65px;
  display: flex;
  flex-direction: row;
  width: 100%;
  align-items: flex-start;
  justify-content: center;
  flex: ${({ theme }) => (theme.isWidget ? '0 0 auto' : '1 1 auto')};
  z-index: 2;
  color: inherit;
  padding: ${({ theme, $hasActiveSpeechBubbleNotification }) =>
    theme.isWidget ? '16px 16px 0' : $hasActiveSpeechBubbleNotification ? '150px 16px 320px' : '150px 16px 176px'};
  margin: ${({ theme }) => (theme.isWidget ? '0' : '-76px auto calc(var(--marginBottomOffset) * -1)')};
  border-bottom-left-radius: ${({ theme }) => (theme.isWidget ? '0' : 'var(--marginBottomOffset)')};
  border-bottom-right-radius: ${({ theme }) => (theme.isWidget ? '0' : 'var(--marginBottomOffset)')};
  min-height: initial;
  background: ${({ theme }) =>
    theme.isWidget
      ? 'transparent'
      : theme.darkMode
        ? 'linear-gradient(180deg, #0c1218 0%, #101820 58%, #0d1c24 100%)'
        : 'linear-gradient(180deg, #f6f8f9 0%, #e7eef2 46%, #d5e2ea 100%)'};

  #card {
    box-shadow: 0 22px 50px rgba(16, 32, 44, 0.1);
  }

  ${Media.upToMedium()} {
    padding: ${({ theme, $hasActiveSpeechBubbleNotification }) =>
      theme.isWidget ? '0 0 16px' : $hasActiveSpeechBubbleNotification ? '150px 16px 330px' : '150px 16px 150px'};
    flex: none;
    min-height: ${({ theme }) => (theme.isWidget ? 'initial' : 'calc(100vh - 200px)')};
  }

  ${Media.upToSmall()} {
    padding: ${({ theme, $hasActiveSpeechBubbleNotification }) =>
      theme.isWidget ? '0 0 16px' : $hasActiveSpeechBubbleNotification ? '90px 16px 400px' : '90px 16px 200px'};
    min-height: ${({ theme }) => (theme.isWidget ? 'initial' : 'calc(100vh - 100px)')};
  }
`
