import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search, Check, Plus } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  group?: string;
}

interface SearchableSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  allowCustom?: boolean;
}

export function SearchableSelect({ options, value, onChange, placeholder = "Selecione...", label, allowCustom = false }: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [wrapperRef]);

  const filteredOptions = options.filter(option => 
    option.label.toLowerCase().includes(searchTerm.toLowerCase()) || 
    (option.group && option.group.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const selectedOption = options.find(opt => opt.value === value);

  // Group options if they have groups
  const groupedOptions = filteredOptions.reduce((acc, option) => {
    const group = option.group || 'Outros';
    if (!acc[group]) acc[group] = [];
    acc[group].push(option);
    return acc;
  }, {} as Record<string, SelectOption[]>);

  const hasGroups = Object.keys(groupedOptions).length > 1 || (Object.keys(groupedOptions).length === 1 && Object.keys(groupedOptions)[0] !== 'Outros');

  const showCustomOption = allowCustom && searchTerm.trim() !== '' && !options.some(opt => opt.label.toLowerCase() === searchTerm.trim().toLowerCase());

  // Determine what to show in the trigger button
  const displayValue = selectedOption ? selectedOption.label : (allowCustom && value ? value : placeholder);

  return (
    <div className="relative w-full" ref={wrapperRef}>
      {label && <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-1 block">{label}</label>}
      <div 
        className="w-full bg-surface-container border-none rounded p-2 text-sm focus-within:ring-2 focus-within:ring-primary flex items-center justify-between cursor-pointer"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className={value ? "text-on-surface truncate" : "text-on-surface-variant truncate"}>
          {displayValue}
        </span>
        <ChevronDown className={`w-4 h-4 text-on-surface-variant transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-1 bg-surface-container-high border border-outline-variant/20 rounded-lg shadow-xl max-h-60 flex flex-col">
          <div className="p-2 border-b border-outline-variant/10 flex items-center gap-2 bg-surface-container-highest rounded-t-lg">
            <Search className="w-4 h-4 text-on-surface-variant flex-shrink-0" />
            <input 
              type="text" 
              className="w-full bg-transparent border-none outline-none text-sm" 
              placeholder="Buscar..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              autoFocus
            />
          </div>
          <div className="overflow-y-auto p-1 rounded-b-lg">
            {showCustomOption && (
              <div 
                className="px-2 py-1.5 text-sm rounded cursor-pointer flex items-center gap-2 hover:bg-primary/10 text-primary font-medium mb-1 border-b border-outline-variant/10"
                onClick={() => {
                  onChange(searchTerm.trim());
                  setIsOpen(false);
                  setSearchTerm('');
                }}
              >
                <Plus className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">Adicionar "{searchTerm.trim()}"</span>
              </div>
            )}
            {filteredOptions.length === 0 && !showCustomOption ? (
              <div className="p-2 text-sm text-on-surface-variant text-center">Nenhum resultado encontrado.</div>
            ) : hasGroups ? (
              Object.entries(groupedOptions).map(([group, opts]) => (
                <div key={group} className="mb-1">
                  <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-primary/70 bg-surface-container/50 rounded">{group}</div>
                  {opts.map(option => (
                    <div 
                      key={option.value}
                      className={`px-2 py-1.5 text-sm rounded cursor-pointer flex items-center justify-between hover:bg-primary/10 ${value === option.value ? 'bg-primary/10 text-primary font-medium' : 'text-on-surface'}`}
                      onClick={() => {
                        onChange(option.value);
                        setIsOpen(false);
                        setSearchTerm('');
                      }}
                    >
                      <span className="truncate pr-2">{option.label}</span>
                      {value === option.value && <Check className="w-4 h-4 flex-shrink-0" />}
                    </div>
                  ))}
                </div>
              ))
            ) : (
              filteredOptions.map(option => (
                <div 
                  key={option.value}
                  className={`px-2 py-1.5 text-sm rounded cursor-pointer flex items-center justify-between hover:bg-primary/10 ${value === option.value ? 'bg-primary/10 text-primary font-medium' : 'text-on-surface'}`}
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                    setSearchTerm('');
                  }}
                >
                  <span className="truncate pr-2">{option.label}</span>
                  {value === option.value && <Check className="w-4 h-4 flex-shrink-0" />}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
