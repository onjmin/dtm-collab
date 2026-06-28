"use client";

import React from "react";

interface PixelModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export default function PixelModal({ isOpen, onClose, title, children }: PixelModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75">
      <div 
        className="w-full max-w-md pixel-border pixel-border-pink p-1 animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between bg-black text-white px-3 py-2 border-b-4 border-black font-mono">
          <span className="font-bold tracking-wider text-xs md:text-sm select-none">
            ▒ {title} ▒
          </span>
          <button 
            onClick={onClose} 
            className="pixel-btn pixel-btn-red text-xs py-1 px-2.5"
            title="閉じる"
          >
            X
          </button>
        </div>

        {/* Content */}
        <div className="bg-[#1d2b53] p-5 text-white">
          {children}
        </div>
      </div>
    </div>
  );
}
