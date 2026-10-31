/** People and human-written chat are a separate opt-in contract from agent sharing. */
export const HUMAN_COLORS = {sky:'#63b7dc',sage:'#80b58a',amber:'#e4b65f',rose:'#d98da7',violet:'#ab8fd6'} as const;
export interface HumanProfile {id:string;name:string;color:keyof typeof HUMAN_COLORS;hair:'short'|'long'|'curly'|'cap';availability:'available'|'busy'|'away'}
export interface HumanPerson extends HumanProfile {x:number;z:number}
export interface HumanMessage {id:string;userId:string;name:string;text:string;createdAt:number;clientId:string}
export interface HumanRoom {id:string;name:string;ownerName:string;isOwner:boolean;open:boolean;dnd:boolean;admitted:boolean;present?:boolean;request:{id:string;status:'pending'|'accepted'|'declined'}|null}
export interface HumanState {viewerId:string;officeId:string;serverNow:number;lease:string;isOwner:boolean;people:HumanPerson[];messages:HumanMessage[]}
