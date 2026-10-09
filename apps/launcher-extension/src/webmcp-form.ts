import { record } from '@web-relay/protocol';

export interface RequiredField {
  name: string;
  label: string;
  description?: string;
  type: 'string' | 'number' | 'integer' | 'boolean';
  choices?: (string | number | boolean)[];
  default?: string | number | boolean;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}
export function requiredFields(schema: unknown): {fields: RequiredField[]; error?: string} {
  const unsupported = (name?: string) => ({fields:[] as RequiredField[],error:name ? `Required field “${name}” is unsupported. Only root-level text, number, boolean, and choice fields are supported; nested objects and arrays are not supported.` : 'This input contract is unsupported. Only required fields at the object root are supported.'});
  if (!record(schema) || (schema.type !== undefined && schema.type !== 'object') || ['$ref','allOf','anyOf','oneOf','if','then','else','not','dependentRequired','dependentSchemas'].some(key=>key in schema)) return unsupported();
  const required = schema.required ?? [];
  if (!Array.isArray(required) || required.some(name=>typeof name !== 'string') || new Set(required).size !== required.length) return unsupported();
  const fields: RequiredField[] = [];
  for (const name of required as string[]) {
    const property = record(schema.properties) ? schema.properties[name] : undefined;
    if (!record(property) || ['$ref','allOf','anyOf','oneOf','if','then','else','not','const'].some(key=>key in property)) return unsupported(name);
    const choices = property.enum;
    const type = property.type ?? (Array.isArray(choices) && choices.length ? typeof choices[0] : undefined);
    if (!['string','number','integer','boolean'].includes(String(type))) return unsupported(name);
    const matches = (value: unknown): value is string | number | boolean => type === 'integer' ? typeof value === 'number' && Number.isInteger(value) : typeof value === type && (typeof value !== 'number' || Number.isFinite(value));
    if (choices !== undefined && (!Array.isArray(choices) || !choices.length || choices.length > 100 || !choices.every(matches))) return unsupported(name);
    const label = typeof property.title === 'string' && property.title.trim() ? property.title : name.replace(/[_-]+/g,' ').replace(/^./,first=>first.toUpperCase());
    const field: RequiredField = {name,label,type:type as RequiredField['type']};
    if (typeof property.description === 'string') field.description = property.description;
    if (Array.isArray(choices)) field.choices = choices;
    if (matches(property.default) && (!field.choices || field.choices.includes(property.default))) field.default = property.default;
    for (const key of ['minLength','maxLength','minimum','maximum'] as const) if (typeof property[key] === 'number' && Number.isFinite(property[key])) field[key] = property[key];
    fields.push(field);
  }
  return {fields};
}

export function mountRequiredForm(container: HTMLElement, schema: unknown) {
  container.replaceChildren();
  const plan = requiredFields(schema);
  const controls: {field: RequiredField; control: HTMLInputElement | HTMLSelectElement; choices?: (string | number | boolean)[]}[] = [];
  if (plan.error || !plan.fields.length) {
    const note = document.createElement('p'); note.className = 'hint';
    note.textContent = plan.error ?? 'This tool has no required inputs.'; container.append(note);
  }
  for (const [index,field] of plan.fields.entries()) {
    const row=document.createElement('div'); row.className='tool-field';
    const label=document.createElement('label'); label.htmlFor=`tool-field-${index}`; label.textContent=`${field.label} (required)`;
    const choices=field.choices ?? (field.type === 'boolean' ? [true,false] : undefined);
    let control: HTMLInputElement | HTMLSelectElement;
    if (choices) {
      const select=document.createElement('select');
      const placeholder=document.createElement('option'); placeholder.value='';placeholder.textContent='Choose…';select.append(placeholder);
      choices.forEach((value,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value);select.append(option);});
      if (field.default !== undefined) select.value=String(choices.indexOf(field.default));
      control=select;
    } else {
      const input=document.createElement('input');input.type=field.type === 'string' ? 'text' : 'number';
      if (input.type === 'number') {input.step=field.type === 'integer' ? '1' : 'any';if(field.minimum !== undefined)input.min=String(field.minimum);if(field.maximum !== undefined)input.max=String(field.maximum);}
      if(field.default !== undefined) input.value=String(field.default);
      control=input;
    }
    control.id=label.htmlFor;control.required=true;row.append(label,control);
    if(field.description) {const help=document.createElement('p');help.id=`tool-help-${index}`;help.className='hint';help.textContent=field.description;control.setAttribute('aria-describedby',help.id);row.append(help);}
    container.append(row);controls.push({field,control,choices});
  }
  return {
    error:plan.error,
    focus:()=>controls[0]?.control.focus(),
    serialize:(): string | undefined => {
      if(plan.error) return undefined;
      const args: Record<string,unknown> = Object.create(null);
      for (const {field,control,choices} of controls) {
        control.setCustomValidity('');
        if (!control.reportValidity()) return undefined;
        const value=choices ? choices[Number(control.value)] : field.type === 'string' ? control.value : Number(control.value);
        // Programmatic fills and declared defaults also need length checks.
        if (typeof value === 'string' && ((field.minLength !== undefined && [...value].length < field.minLength) || (field.maxLength !== undefined && [...value].length > field.maxLength))) {
          control.setCustomValidity(field.minLength !== undefined && [...value].length < field.minLength ? `Enter at least ${field.minLength} characters.` : `Enter at most ${field.maxLength} characters.`);control.reportValidity();return undefined;
        }
        args[field.name]=value;
      }
      const input=JSON.stringify(args);
      if(input.length>2000) {controls[0]?.control.setCustomValidity('Tool inputs must fit within 2000 characters.');controls[0]?.control.reportValidity();return undefined;}
      return input;
    },
  };
}
