"""Kept for reference: the Dovoza Thiomax Plus workbook is now built by build_defined_market.py (product key 'dovoza')."""
import os,sys
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from build_defined_market import build
if __name__=='__main__': build('dovoza')
