import {describe,expect,it,vi} from 'vitest';
import {screen,within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {makeRepo,renderWithProviders} from '@/test/renderWithProviders';
import {StorageAreasPage} from './StorageAreasPage';
import {CycleCountsPage} from './CycleCountsPage';
import {TasksPage} from './TasksPage';
import {ReceivingPage} from './ReceivingPage';

describe('read-only audit remediation',()=>{
  it.each([['storage',StorageAreasPage,'Warehouse'],['counts',CycleCountsPage,'Location'],['receiving',ReceivingPage,'Receive into']] as const)('requires a warehouse choice in %s before new work',async(_name,Page,label)=>{
    const data=await makeRepo().getData();
    data.locations.push({id:'test-site',name:'Old test site',type:'warehouse',active:true});
    const repo=makeRepo(data);
    const before=await repo.getData();
    renderWithProviders(<Page/>,{repo});
    const select=await screen.findByRole('combobox',{name:label});
    expect(select).toHaveValue('');
    await userEvent.selectOptions(select,'loc-wh');
    expect(select).toHaveValue('loc-wh');
    expect(await repo.getData()).toEqual(before);
  });
  it('shows permitted staging product and location context without a receipt',async()=>{
    const data=await makeRepo().getData();
    const repo=makeRepo(data);
    vi.spyOn(repo,'listWarehouseTasks').mockResolvedValue({rows:[{
      id:'staging-task',type:'putaway',sourceId:'staging:'+JSON.stringify(['shirt-l','loc-wh']),
      title:'Put away stock',status:'due',
    }]});
    renderWithProviders(<TasksPage/>,{repo,role:'warehouse_operator'});
    const list=await screen.findByRole('list',{name:'due tasks'});
    expect(within(list).getByText(/General receiving area/)).toBeVisible();
    expect(within(list).getByText(new RegExp(data.products.find(p=>p.id==='shirt-l')!.sku))).toBeVisible();
    expect(within(list).queryByText(/Source details unavailable/)).not.toBeInTheDocument();
    expect(within(list).getByRole('link',{name:'Open putaway source'})).toHaveAttribute('href',expect.stringContaining('staging%3A'));
  });
  it('tells the Associate who reviews a restricted stock variance without reading approval data',async()=>{
    const repo=makeRepo();
    vi.spyOn(repo,'listWarehouseTasks').mockResolvedValue({rows:[{id:'task',type:'exception',sourceId:'exception',title:'Review warehouse exception',status:'due'}]});
    vi.spyOn(repo,'listExceptions').mockResolvedValue({rows:[{id:'exception',type:'count_variance',severity:'P2',sourceType:'stock_change_request',sourceId:'request',status:'open',createdAt:'2026-11-08'}]});
    const read=vi.spyOn(repo,'listStockChangeRequests');
    renderWithProviders(<TasksPage/>,{repo,role:'warehouse_operator'});
    expect(await screen.findByText(/Operations Lead.*review.*stock variance/i)).toBeVisible();
    expect(read).not.toHaveBeenCalled();
  });
});
