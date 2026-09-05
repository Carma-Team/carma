import type { ElementType, HTMLAttributes, ReactNode } from 'react';
import styles from './Typography.module.css';

type HeadingProps = HTMLAttributes<HTMLHeadingElement> & {
  level?: 1 | 2 | 3;
  children: ReactNode;
};

export function Heading({ level = 1, children, className, ...props }: HeadingProps) {
  const Tag = `h${level}` as ElementType;
  const levelClass = styles[`h${level}`];
  return (
    <Tag className={[levelClass, className].filter(Boolean).join(' ')} {...props}>
      {children}
    </Tag>
  );
}

type TextVariant = 'body' | 'caption' | 'label' | 'eyebrow' | 'metric';

type TextProps = HTMLAttributes<HTMLElement> & {
  variant?: TextVariant;
  as?: ElementType;
  children: ReactNode;
};

export function Text({ variant = 'body', as, children, className, ...props }: TextProps) {
  const Tag = as ?? 'p';
  return (
    <Tag className={[styles[variant], className].filter(Boolean).join(' ')} {...props}>
      {children}
    </Tag>
  );
}
