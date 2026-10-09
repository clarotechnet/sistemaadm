import type { Employee } from "../../types";

export type MovementKind = "ADMISSION" | "TERMINATION";
export type MovementScope = "ALL" | MovementKind;
export type MovementRow = { id: string; kind: MovementKind; date: string; employee: Employee };

export function isValidCompetence(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function employeeUnit(employee: Employee): string {
  return employee.externalUnitName.trim() || (employee.source === "MANUAL" ? "Cadastro manual" : "Unidade não informada");
}

export function movementRowsForMonth(employees: Employee[], competence: string): MovementRow[] {
  if (!isValidCompetence(competence)) return [];
  const result: MovementRow[] = [];
  for (const employee of employees) {
    if (employee.admissionDate?.startsWith(competence + "-")) {
      result.push({ id: employee.id + ":admission", kind: "ADMISSION", date: employee.admissionDate, employee });
    }
    if (employee.terminationDate?.startsWith(competence + "-")) {
      result.push({ id: employee.id + ":termination", kind: "TERMINATION", date: employee.terminationDate, employee });
    }
  }
  return result.sort((a,b) => b.date.localeCompare(a.date) || a.employee.name.localeCompare(b.employee.name, "pt-BR") || a.kind.localeCompare(b.kind));
}

export function movementMonthlySummary(employees: Employee[], competence: string) {
  const rows=movementRowsForMonth(employees,competence);
  const admissions=rows.filter(row=>row.kind==="ADMISSION").length;
  const terminations=rows.filter(row=>row.kind==="TERMINATION").length;
  return {
    admissions, terminations, net: admissions-terminations,
    activeNow:employees.filter(employee=>employee.status==="ATIVO").length,
    terminatedNow:employees.filter(employee=>employee.status==="DESLIGADO").length,
    missingAdmission:employees.filter(employee=>!employee.admissionDate).length,
    missingTermination:employees.filter(employee=>employee.status==="DESLIGADO"&&!employee.terminationDate).length,
    movementRows:rows,
  };
}

export function monthShift(value:string,amount:number):string {
  if(!isValidCompetence(value))return value;
  const [year,month]=value.split("-").map(Number);
  const next=new Date(Date.UTC(year,month-1+amount,1));
  return next.getUTCFullYear()+"-"+String(next.getUTCMonth()+1).padStart(2,"0");
}
