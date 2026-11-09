'use strict';
// Share the actual bounded editor contract with voice/chat clients. This is
// capability disclosure, never permission to mutate or a claim of Office parity.
const core=require('../office-suite-core');
function capabilities(kind,model={}){
  const common={saveMode:'new_owned_copy',requiresExactRevision:true,requiresUserApproval:true,maxOperations:200,maxRequestBytes:42000};
  if(kind==='document')return {...common,operations:['set_text','format_text','append_paragraph','insert_table','insert_complex_table',...(model.pageText?.editable?['set_page_text']:[])],limits:{maxParagraphCharacters:6000,maxTableRows:30,maxTableColumns:10,maxTableCellCharacters:500,maxPageTextCharacters:2000},protectedBlockIndexes:(model.blocks||[]).filter(b=>b.textEditProtection).map(b=>b.index),unsupported:['track_changes_authoring_or_accept_reject','nested_table_layout','arbitrary_selection_formatting','full_pagination'],notes:['Read exact block indexes; ask when the requested target is ambiguous.','Text fields and revisions may be protected; do not flatten or bypass protection.','Header/footer support is default plain text in a single-section document only.']};
  if(kind==='spreadsheet')return {...common,operations:['set_cell','set_formula','format_cell','insert_chart'],formulaFunctions:[...core.supported],limits:{editableRange:'A1:AN1000',chartColumns:2,maxChartRows:100,maxChartTitleCharacters:160},chartAvailableSheets:(model.sheets||[]).flatMap((s,i)=>s.hasDrawing?[]:[i]),unsupported:['pivot_tables','approximate_lookup','external_data_functions','shared_or_array_formula_editing','macros'],notes:['Sheet indexes are zero-based. Read exact sheet/cell/range before proposing edits.','Chart needs two adjacent label/numeric columns without a header row; existing drawings are protected.','Formula calculations are a bounded subset, not complete Excel semantics.']};
  if(kind==='presentation')return {...common,operations:['set_text','format_text','move_text','slide_background','add_slide_text','add_slide','reorder_slide'],limits:{maxSlides:100,maxTextCharacters:6000},unsupported:['full_master_layout_editing','animation_effects','grouped_shape_geometry','full_slide_playback'],notes:['Pages are one-based; block indexes are zero-based.','move_text changes the entire shape containing the selected paragraph.']};
  return null;
}
module.exports={capabilities};
