using System;
using System.Collections.Generic;
using System.Linq;
using PacForgeBridge;

class BlockDeleteTests
{
    static int failed, passed;
    static void Test(string name, Action test) { try { test(); passed++; } catch(Exception e) { failed++; Console.WriteLine("FAIL " + name + ": " + e.Message); } }
    static void Assert(bool ok) { if(!ok) throw new Exception("assertion failed"); }
    static void Refuses(Action action) { try { action(); } catch(InvalidOperationException) { return; } throw new Exception("unsafe request accepted"); }
    static DeleteBlockIdentity Target() { return new DeleteBlockIdentity { name="Unused",kind="FB",number=25,folder="PLC\\Program blocks",language="SCL",consistent=true }; }
    static DeleteReferenceSource Root() { return new DeleteReferenceSource { name="Unused",address="%FB25",path="PLC\\Program blocks",type="Function block",children=new List<DeleteReferenceSource>(),references=new List<DeleteReference> { new DeleteReference {name="Other",locations=new List<DeleteReferenceLocation> {new DeleteReferenceLocation {relation="Uses",access="Read"}}}} }; }
    static void Main()
    {
        Test("known unused FB accepted",()=>BlockDeletePolicy.Unused(Target(), new[]{Root()}));
        Test("incoming caller refused",()=> { var r=Root(); r.references[0].locations[0].relation="UsedBy"; Refuses(()=>BlockDeletePolicy.Unused(Target(),new[]{r})); });
        Test("instance relation refused",()=> { var r=Root(); r.references[0].locations[0].relation="TypeInstance"; Refuses(()=>BlockDeletePolicy.Unused(Target(),new[]{r})); });
        Test("unknown reference refused",()=> { var r=Root(); r.references[0].locations[0].relation="FutureRelation"; Refuses(()=>BlockDeletePolicy.Unused(Target(),new[]{r})); });
        Test("child incoming caller refused",()=> { var r=Root(); var c=Root(); c.references[0].locations[0].relation="UsedBy"; r.children.Add(c); Refuses(()=>BlockDeletePolicy.Unused(Target(),new[]{r})); });
        Test("empty query refused",()=>Refuses(()=>BlockDeletePolicy.Unused(Target(),new DeleteReferenceSource[0])));
        Test("empty location refused",()=> {var r=Root();r.references[0].locations.Clear();Refuses(()=>BlockDeletePolicy.Unused(Target(),new[]{r}));});
        Test("wrong root identity refused",()=> {var r=Root();r.address="%FB26";Refuses(()=>BlockDeletePolicy.Unused(Target(),new[]{r}));});
        Test("inconsistent target refused",()=> {var m=Target();m.consistent=false;Refuses(()=>BlockDeletePolicy.Unused(m,new[]{Root()}));});
        Test("safety block refused",()=> {var m=Target();m.language="F_LAD";Refuses(()=>BlockDeletePolicy.Candidate(m,0));});
        Test("ordinary FBD accepted",()=> {var m=Target();m.language="FBD";BlockDeletePolicy.Candidate(m,0);});
        Test("OB refused",()=> {var m=Target();m.kind="OB";Refuses(()=>BlockDeletePolicy.Candidate(m,0));});
        Test("instance DB refused",()=>Refuses(()=>BlockDeletePolicy.Candidate(Target(),1)));
        Test("positive control requires known caller",()=> {var r=Root();r.references[0].locations[0].relation="UsedBy";r.references[0].locations[0].access="Call";BlockDeletePolicy.Control(Target(),new[]{r},"Other");Refuses(()=>BlockDeletePolicy.Control(Target(),new[]{r},"Missing"));});
        Test("positive control rejects outgoing call",()=> {var r=Root();r.references[0].locations[0].access="Call";Refuses(()=>BlockDeletePolicy.Control(Target(),new[]{r},"Other"));});
        Test("export metadata date does not change fingerprint",()=> Assert(BlockDeletePolicy.Fingerprint("<Document><DocumentInfo><Created>one</Created></DocumentInfo><Block><Code>x</Code></Block></Document>")==BlockDeletePolicy.Fingerprint("<Document>\n<DocumentInfo><Created>two</Created></DocumentInfo>\n<Block><Code>x</Code></Block></Document>")));
        Test("code and literal whitespace changes alter fingerprint",()=> {var a=BlockDeletePolicy.Fingerprint("<Document><Block><Code>'x '</Code></Block></Document>");Assert(a!=BlockDeletePolicy.Fingerprint("<Document><Block><Code>'x'</Code></Block></Document>"));});
        Test("DTD rejected",()=>Refuses(()=>BlockDeletePolicy.Fingerprint("<!DOCTYPE Document [<!ENTITY a 'x'>]><Document>&a;</Document>")));
        Test("whitespace literal in leaf is preserved",()=>Assert(BlockDeletePolicy.Fingerprint("<Document><Text> </Text></Document>")!=BlockDeletePolicy.Fingerprint("<Document><Text></Text></Document>")));
        Test("rollback attempts every restore despite failure",()=> {var order=new List<int>();var errors=BlockDeletePolicy.RestoreAll(new[]{1,2,3}, n=>{order.Add(n);if(n==2)throw new Exception("failed");});Assert(order.SequenceEqual(new[]{1,2,3}) && errors.Count==1);});
        Test("new route requires configured auth",()=>{Refuses(()=>BlockDeletePolicy.RequireAuthentication(null,true));Refuses(()=>BlockDeletePolicy.RequireAuthentication("set",false));BlockDeletePolicy.RequireAuthentication("set",true);});
        Test("recovery failure never compiles or saves",()=>{var seen=new List<string>();var r=BlockDeletePolicy.Recover(new[]{1,2},n=>{seen.Add("r"+n);if(n==1)throw new Exception("import failed");},n=>seen.Add("v"+n),()=>seen.Add("compile"),()=>seen.Add("save"));Assert(!r.complete && seen.SequenceEqual(new[]{"r1","r2","v1","v2"}));});
        Test("verification failure never saves",()=>{bool saved=false;var r=BlockDeletePolicy.Recover(new[]{1},n=>{},n=>{throw new Exception("wrong content");},()=>{},()=>saved=true);Assert(!r.complete && !saved);});
        Test("recovery requires compile and save",()=>{var seen=new List<string>();var r=BlockDeletePolicy.Recover(new[]{1},n=>seen.Add("restore"),n=>seen.Add("verify"),()=>seen.Add("compile"),()=>seen.Add("save"));Assert(r.complete && seen.SequenceEqual(new[]{"restore","verify","compile","save"}));});
        Test("compile failure never saves",()=>{bool saved=false;var r=BlockDeletePolicy.Recover(new[]{1},n=>{},n=>{},()=>{throw new Exception("compile failed");},()=>saved=true);Assert(!r.complete && !saved);});
        Test("expiry and changed context refuse apply",()=>{Refuses(()=>BlockDeletePolicy.ValidatePlan(true,"id","id",DateTime.UtcNow.AddMinutes(-1),"a","a","plc","plc"));Refuses(()=>BlockDeletePolicy.ValidatePlan(true,"id","id",DateTime.UtcNow.AddMinutes(1),"a","b","plc","plc"));Refuses(()=>BlockDeletePolicy.ValidatePlan(false,"id","id",DateTime.UtcNow.AddMinutes(1),"a","a","plc","plc"));BlockDeletePolicy.ValidatePlan(true,"id","id",DateTime.UtcNow.AddMinutes(1),"a","a","plc","plc");});
        Console.WriteLine(passed+" passed; "+failed+" failed");
        Environment.ExitCode=failed==0?0:1;
    }
}
